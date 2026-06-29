use crate::error::CommandError;
use crate::kubectl::kubectl_binary;
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering as CmpOrdering,
    collections::{BinaryHeap, HashMap},
    env,
    process::Child,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

mod readers;
mod request_validation;
mod start_stream;
mod timestamp;
use readers::{spawn_stderr_reader, spawn_stdout_reader};
use request_validation::validate;
use start_stream::{
    emit_stream_started, insert_active_process, kubectl_tail_args, spawn_exit_watcher,
    spawn_kubectl_tail, spawn_stream_readers,
};
use timestamp::{extract_log_time_ms, order_time_ms};

const DEFAULT_REORDER_WINDOW_MS: u128 = 1000;
const FLUSH_INTERVAL_MS: u64 = 50;
const MAX_BATCH_SIZE: usize = 50;
const STREAM_FLUSH_ACK_TIMEOUT_MS: u64 = 500;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartLogStreamRequest {
    pub stream_id: String,
    pub context: Option<String>,
    pub namespace: String,
    pub pod: String,
    pub container: String,
    pub source_type: String,
    pub file_path: String,
    pub initial_tail_lines: u32,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogLineEvent {
    pub stream_id: String,
    pub source_type: String,
    pub raw: String,
    pub received_at: u128,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogLinesEvent {
    pub lines: Vec<LogLineEvent>,
    pub emitted_at: u128,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamStartedEvent {
    pub stream_id: String,
    pub received_at: u128,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamStderrEvent {
    pub stream_id: String,
    pub line: String,
    pub received_at: u128,
}
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogStreamExitEvent {
    pub stream_id: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub requested_stop: bool,
}

#[derive(Debug, Clone)]
struct LogEnvelope {
    stream_id: String,
    source_type: String,
    raw: String,
    #[allow(dead_code)]
    log_time_ms: Option<u128>,
    received_at: u128,
    order_time_ms: u128,
    seq: u64,
}

impl LogEnvelope {
    fn new(
        stream_id: String,
        source_type: String,
        raw: String,
        received_at: u128,
        seq: u64,
    ) -> Self {
        let log_time_ms = extract_log_time_ms(&raw);
        let order_time_ms = order_time_ms(log_time_ms, received_at);
        Self {
            stream_id,
            source_type,
            raw,
            log_time_ms,
            received_at,
            order_time_ms,
            seq,
        }
    }
}

impl From<LogEnvelope> for LogLineEvent {
    fn from(value: LogEnvelope) -> Self {
        let LogEnvelope {
            stream_id,
            source_type,
            raw,
            received_at,
            log_time_ms: _,
            order_time_ms: _,
            seq: _,
        } = value;
        Self {
            stream_id,
            source_type,
            raw,
            received_at,
        }
    }
}

#[derive(Debug, Clone)]
struct QueuedLog(LogEnvelope);

impl PartialEq for QueuedLog {
    fn eq(&self, other: &Self) -> bool {
        (self.0.order_time_ms, self.0.received_at, self.0.seq)
            == (other.0.order_time_ms, other.0.received_at, other.0.seq)
    }
}
impl Eq for QueuedLog {}
impl PartialOrd for QueuedLog {
    fn partial_cmp(&self, other: &Self) -> Option<CmpOrdering> {
        Some(self.cmp(other))
    }
}
impl Ord for QueuedLog {
    fn cmp(&self, other: &Self) -> CmpOrdering {
        // Reverse ordering because BinaryHeap is a max-heap and we need earliest first.
        (other.0.order_time_ms, other.0.received_at, other.0.seq).cmp(&(
            self.0.order_time_ms,
            self.0.received_at,
            self.0.seq,
        ))
    }
}

enum MergeMessage {
    Line(LogEnvelope),
    StreamEnded { stream_id: String, ack: Sender<()> },
    Shutdown,
}

struct MergeHandle {
    tx: Sender<MergeMessage>,
}

pub struct ActiveLogProcess {
    pub stream_id: String,
    pub child: Arc<Mutex<Child>>,
    pub requested_stop: Arc<AtomicBool>,
}
pub struct LogProcessState {
    pub active: Mutex<HashMap<String, ActiveLogProcess>>,
    merge: Mutex<Option<MergeHandle>>,
    seq: Arc<AtomicU64>,
}
impl Default for LogProcessState {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
            merge: Mutex::new(None),
            seq: Arc::new(AtomicU64::new(1)),
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn debug_enabled() -> bool {
    env::var("KLOGCAT_DEBUG").is_ok_and(|v| !matches!(v.as_str(), "" | "0" | "false" | "False"))
        || env::args().any(|arg| arg == "--debug")
}

fn reorder_window_ms() -> u128 {
    env::var("KLOGCAT_REORDER_WINDOW_MS")
        .ok()
        .and_then(|v| v.parse::<u128>().ok())
        .unwrap_or(DEFAULT_REORDER_WINDOW_MS)
}

fn drain_flushable(
    heap: &mut BinaryHeap<QueuedLog>,
    max_seen_order_time: u128,
    now: u128,
    reorder_window_ms: u128,
    max_batch_size: usize,
) -> Vec<LogEnvelope> {
    let mut drained = Vec::new();
    while drained.len() < max_batch_size {
        let Some(peek) = heap.peek() else {
            break;
        };
        let order_ready = reorder_window_ms == 0
            || peek.0.order_time_ms <= max_seen_order_time.saturating_sub(reorder_window_ms);
        let age_ready = peek.0.received_at <= now.saturating_sub(reorder_window_ms);
        if !order_ready && !age_ready {
            break;
        }
        if let Some(item) = heap.pop() {
            drained.push(item.0);
        }
    }
    drained
}

fn drain_stream(
    heap: &mut BinaryHeap<QueuedLog>,
    stream_id: &str,
    max_batch_size: usize,
) -> Vec<LogEnvelope> {
    let mut drained = Vec::new();
    let mut keep = Vec::new();
    while let Some(item) = heap.pop() {
        if item.0.stream_id == stream_id && drained.len() < max_batch_size {
            drained.push(item.0);
        } else {
            keep.push(item);
        }
    }
    for item in keep {
        heap.push(item);
    }
    drained
}

fn emit_batch<R: tauri::Runtime>(app: &tauri::AppHandle<R>, batch: Vec<LogEnvelope>, debug: bool) {
    if batch.is_empty() {
        return;
    }
    let lines = batch
        .into_iter()
        .map(LogLineEvent::from)
        .collect::<Vec<_>>();
    if debug {
        eprintln!(
            "[klogcat debug] emitting ordered batch with {} lines",
            lines.len()
        );
    }
    let _ = app.emit(
        "log://lines",
        LogLinesEvent {
            lines,
            emitted_at: now_ms(),
        },
    );
}

fn flush_all<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    heap: &mut BinaryHeap<QueuedLog>,
    debug: bool,
) {
    while !heap.is_empty() {
        let batch = drain_flushable(heap, u128::MAX, u128::MAX, 0, MAX_BATCH_SIZE);
        emit_batch(app, batch, debug);
    }
}

fn flush_stream_before_exit_emit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    heap: &mut BinaryHeap<QueuedLog>,
    stream_id: &str,
    debug: bool,
) {
    if debug {
        eprintln!("[klogcat debug] stream {stream_id} merge flush requested before exit");
    }
    loop {
        let batch = drain_stream(heap, stream_id, MAX_BATCH_SIZE);
        let empty = batch.is_empty();
        emit_batch(app, batch, debug);
        if empty {
            break;
        }
    }
    if debug {
        eprintln!("[klogcat debug] stream {stream_id} merge flush acked before exit");
    }
}

fn run_merge_worker<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    rx: mpsc::Receiver<MergeMessage>,
    reorder_window_ms: u128,
    debug: bool,
) {
    let mut heap = BinaryHeap::new();
    let mut max_seen_order_time = 0u128;
    loop {
        match rx.recv_timeout(Duration::from_millis(FLUSH_INTERVAL_MS)) {
            Ok(MergeMessage::Line(envelope)) => {
                max_seen_order_time = max_seen_order_time.max(envelope.order_time_ms);
                heap.push(QueuedLog(envelope));
            }
            Ok(MergeMessage::StreamEnded { stream_id, ack }) => {
                flush_stream_before_exit_emit(&app, &mut heap, &stream_id, debug);
                let _ = ack.send(());
            }
            Ok(MergeMessage::Shutdown) => {
                flush_all(&app, &mut heap, debug);
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                flush_all(&app, &mut heap, debug);
                break;
            }
        }
        let batch = drain_flushable(
            &mut heap,
            max_seen_order_time,
            now_ms(),
            reorder_window_ms,
            MAX_BATCH_SIZE,
        );
        emit_batch(&app, batch, debug);
    }
}

impl LogProcessState {
    fn ensure_merge_worker<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
    ) -> Sender<MergeMessage> {
        let mut guard = self.merge.lock().unwrap();
        if let Some(handle) = guard.as_ref() {
            return handle.tx.clone();
        }
        let (tx, rx) = mpsc::channel::<MergeMessage>();
        let worker_tx = tx.clone();
        let window = reorder_window_ms();
        let debug = debug_enabled();
        thread::spawn(move || run_merge_worker(app, rx, window, debug));
        *guard = Some(MergeHandle { tx: worker_tx });
        tx
    }

    fn merge_sender(&self) -> Option<Sender<MergeMessage>> {
        self.merge.lock().unwrap().as_ref().map(|h| h.tx.clone())
    }

    pub fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        request: StartLogStreamRequest,
    ) -> Result<(), CommandError> {
        validate(&request)?;
        let mut guard = self.active.lock().unwrap();
        if guard.contains_key(&request.stream_id) {
            return Err(CommandError::new(
                "stream_already_running",
                "a log stream with this id is already running",
            ));
        }

        let log_tx = self.ensure_merge_worker(app.clone());
        let debug = debug_enabled();
        let args = kubectl_tail_args(&request);
        if debug {
            eprintln!("[klogcat debug] starting stream {}", request.stream_id);
            eprintln!("[klogcat debug] source type: {}", request.source_type);
            eprintln!(
                "[klogcat debug] command: {} {}",
                kubectl_binary(),
                args.join(" ")
            );
        }
        let mut child = spawn_kubectl_tail(&args)?;
        let readers = spawn_stream_readers(
            &mut child,
            app.clone(),
            log_tx,
            &request.stream_id,
            &request.source_type,
            self.seq.clone(),
            debug,
        );
        let child = Arc::new(Mutex::new(child));
        let requested = Arc::new(AtomicBool::new(false));
        let stream_id = request.stream_id.clone();

        insert_active_process(&mut guard, &stream_id, child.clone(), requested.clone());
        drop(guard);
        emit_stream_started(&app, &stream_id);
        spawn_exit_watcher(app, stream_id, child, requested, readers, debug);
        Ok(())
    }

    pub fn stop(&self, stream_id: &str) -> Result<(), CommandError> {
        if debug_enabled() {
            eprintln!("[klogcat debug] stopping stream {stream_id}");
        }
        let active = self.remove_active_for_stop(stream_id)?;
        wait_for_stream_stop(active)
    }

    fn remove_active_for_stop(&self, stream_id: &str) -> Result<ActiveLogProcess, CommandError> {
        let mut guard = self.active.lock().unwrap();
        let Some(active) = guard.get(stream_id) else {
            return Err(CommandError::new("stream_not_found", "stream not found"));
        };
        active.requested_stop.store(true, Ordering::SeqCst);
        Ok(guard.remove(stream_id).unwrap())
    }

    pub fn stop_all_blocking(&self) {
        let active: Vec<_> = self
            .active
            .lock()
            .unwrap()
            .drain()
            .map(|(_, active)| active)
            .collect();
        for active in active {
            active.requested_stop.store(true, Ordering::SeqCst);
            let _ = active.child.lock().unwrap().kill();
        }
        if let Some(tx) = self.merge_sender() {
            let _ = tx.send(MergeMessage::Shutdown);
        }
    }
}

fn wait_for_stream_stop(active: ActiveLogProcess) -> Result<(), CommandError> {
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut sent_kill = false;
    loop {
        if stream_has_stopped_or_was_killed(&active, deadline, &mut sent_kill)? {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn stream_has_stopped_or_was_killed(
    active: &ActiveLogProcess,
    deadline: Instant,
    sent_kill: &mut bool,
) -> Result<bool, CommandError> {
    let mut child = active.child.lock().unwrap();
    match child.try_wait() {
        Ok(Some(_)) => Ok(true),
        Ok(None) => {
            kill_if_needed(&mut child, deadline, sent_kill);
            Ok(Instant::now() >= deadline)
        }
        Err(e) => Err(
            CommandError::new("stream_stop_failed", "failed to stop stream")
                .with_details(e.to_string()),
        ),
    }
}

fn kill_if_needed(child: &mut Child, deadline: Instant, sent_kill: &mut bool) {
    if !*sent_kill || Instant::now() >= deadline {
        let _ = child.kill();
        *sent_kill = true;
    }
}

#[cfg(test)]
mod mocked_process;
