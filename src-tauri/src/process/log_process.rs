use crate::error::CommandError;
use crate::process::line_splitter::LineSplitter;
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering as CmpOrdering,
    collections::{BinaryHeap, HashMap},
    env,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Sender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

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

fn order_time_ms(log_time_ms: Option<u128>, received_at: u128) -> u128 {
    log_time_ms.unwrap_or(received_at)
}

fn epoch_number_to_ms(n: f64) -> Option<u128> {
    if !n.is_finite() || n < 0.0 {
        return None;
    }
    let value = n as u128;
    Some(if value > 10_000_000_000 {
        value
    } else {
        value * 1000
    })
}

fn parse_time_string_ms(value: &str) -> Option<u128> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.timestamp_millis().max(0) as u128);
    }
    for fmt in [
        "%Y-%m-%d %H:%M:%S%.3f",
        "%Y-%m-%d %H:%M:%S,%3f",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, fmt) {
            return Some(
                DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)
                    .timestamp_millis()
                    .max(0) as u128,
            );
        }
    }
    None
}

fn extract_json_log_time_ms(raw: &str) -> Option<u128> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    for key in ["epochTime", "timestamp"] {
        if let Some(n) = value.get(key).and_then(|v| v.as_f64()) {
            return epoch_number_to_ms(n);
        }
    }
    for key in ["time", "@timestamp"] {
        if let Some(s) = value.get(key).and_then(|v| v.as_str()) {
            if let Some(ms) = parse_time_string_ms(s) {
                return Some(ms);
            }
        }
    }
    None
}

/// Extracts a timestamp used for backend ordering only. Timezone-less prefixes are interpreted as UTC.
fn extract_log_time_ms(raw: &str) -> Option<u128> {
    let trimmed = raw.trim_start();
    if trimmed.starts_with('{') {
        if let Some(ms) = extract_json_log_time_ms(trimmed) {
            return Some(ms);
        }
    }
    let prefix = if let Some(rest) = trimmed.strip_prefix('[') {
        rest
    } else {
        trimmed
    };
    let candidates = [24usize, 23, 19];
    for len in candidates {
        if prefix.len() >= len {
            let candidate = &prefix[..len];
            if let Some(ms) = parse_time_string_ms(candidate) {
                return Some(ms);
            }
        }
    }
    None
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
                if debug {
                    eprintln!(
                        "[klogcat debug] stream {stream_id} merge flush requested before exit"
                    );
                }
                loop {
                    let batch = drain_stream(&mut heap, &stream_id, MAX_BATCH_SIZE);
                    let empty = batch.is_empty();
                    emit_batch(&app, batch, debug);
                    if empty {
                        break;
                    }
                }
                let _ = ack.send(());
                if debug {
                    eprintln!("[klogcat debug] stream {stream_id} merge flush acked before exit");
                }
            }
            Ok(MergeMessage::Shutdown) => {
                while !heap.is_empty() {
                    let batch = drain_flushable(&mut heap, u128::MAX, u128::MAX, 0, MAX_BATCH_SIZE);
                    emit_batch(&app, batch, debug);
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                while !heap.is_empty() {
                    let batch = drain_flushable(&mut heap, u128::MAX, u128::MAX, 0, MAX_BATCH_SIZE);
                    emit_batch(&app, batch, debug);
                }
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

fn is_dns_label(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 63
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && bytes
            .first()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && bytes
            .last()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn is_dns_subdomain(value: &str) -> bool {
    !value.is_empty() && value.len() <= 253 && value.split('.').all(is_dns_label)
}

fn validate(r: &StartLogStreamRequest) -> Result<(), CommandError> {
    if r.stream_id.trim().is_empty()
        || r.namespace.trim().is_empty()
        || r.pod.trim().is_empty()
        || r.container.trim().is_empty()
        || r.file_path.trim().is_empty()
    {
        return Err(CommandError::new(
            "invalid_source_config",
            "stream request fields must be non-empty",
        ));
    }
    if !matches!(r.source_type.as_str(), "app" | "access" | "error") {
        return Err(CommandError::new(
            "invalid_source_config",
            "sourceType must be app, access, or error",
        ));
    }
    if !is_dns_label(&r.namespace) {
        return Err(CommandError::new(
            "invalid_source_config",
            "namespace must be a valid Kubernetes DNS label",
        ));
    }
    if !is_dns_subdomain(&r.pod) {
        return Err(CommandError::new(
            "invalid_source_config",
            "pod must be a valid Kubernetes DNS subdomain",
        ));
    }
    if !r.file_path.starts_with('/') || r.file_path.contains('\0') {
        return Err(CommandError::new(
            "invalid_source_config",
            "filePath must be absolute and contain no null byte",
        ));
    }
    if r.initial_tail_lines > 100000 {
        return Err(CommandError::new(
            "invalid_source_config",
            "initialTailLines must be <= 100000",
        ));
    }
    Ok(())
}

fn spawn_stdout_reader<R: Read + Send + 'static>(
    mut reader: R,
    log_tx: Sender<MergeMessage>,
    stream_id: String,
    source_type: String,
    seq: Arc<AtomicU64>,
    debug: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut sp = LineSplitter::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for line in sp.push(&buf[..n]) {
                        send_stdout_line(&log_tx, &seq, &stream_id, &source_type, line, debug);
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(line) = sp.flush() {
            send_stdout_line(&log_tx, &seq, &stream_id, &source_type, line, debug);
        }
    })
}

fn send_stdout_line(
    log_tx: &Sender<MergeMessage>,
    seq: &AtomicU64,
    stream_id: &str,
    source_type: &str,
    line: String,
    debug: bool,
) {
    if debug {
        eprintln!("[klogcat debug] stdout {stream_id} {source_type}: {line}");
    }
    let seq = seq.fetch_add(1, Ordering::SeqCst);
    let envelope = LogEnvelope::new(
        stream_id.to_string(),
        source_type.to_string(),
        line,
        now_ms(),
        seq,
    );
    if let Err(e) = log_tx.send(MergeMessage::Line(envelope)) {
        if debug {
            eprintln!("[klogcat debug] merge queue send failed for {stream_id}/{source_type}: {e}");
        }
    }
}

fn spawn_stderr_reader<R: Read + Send + 'static, T: tauri::Runtime>(
    mut reader: R,
    app: tauri::AppHandle<T>,
    stream_id: String,
    debug: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut sp = LineSplitter::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    for line in sp.push(&buf[..n]) {
                        emit_stderr(&app, &stream_id, line, debug);
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(line) = sp.flush() {
            emit_stderr(&app, &stream_id, line, debug);
        }
    })
}

fn emit_stderr<T: tauri::Runtime>(
    app: &tauri::AppHandle<T>,
    stream_id: &str,
    line: String,
    debug: bool,
) {
    if debug {
        eprintln!("[klogcat debug] stderr {stream_id}: {line}");
    }
    let _ = app.emit(
        "log://stderr",
        LogStreamStderrEvent {
            stream_id: stream_id.to_string(),
            line,
            received_at: now_ms(),
        },
    );
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
        let tail_n = request.initial_tail_lines.to_string();
        let debug = debug_enabled();
        let mut args = Vec::new();
        if let Some(context) = request.context.as_deref().filter(|c| !c.trim().is_empty()) {
            args.push("--context".to_string());
            args.push(context.to_string());
        }
        args.extend([
            "exec".to_string(),
            "-n".to_string(),
            request.namespace.clone(),
            request.pod.clone(),
            "-c".to_string(),
            request.container.clone(),
            "--".to_string(),
            "tail".to_string(),
            "-n".to_string(),
            tail_n,
            "-F".to_string(),
            request.file_path.clone(),
        ]);
        if debug {
            eprintln!("[klogcat debug] starting stream {}", request.stream_id);
            eprintln!("[klogcat debug] source type: {}", request.source_type);
            eprintln!("[klogcat debug] command: kubectl {}", args.join(" "));
        }
        let mut child = Command::new("kubectl")
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                CommandError::new("stream_spawn_failed", "failed to spawn kubectl exec tail")
                    .with_details(e.to_string())
            })?;
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let requested = Arc::new(AtomicBool::new(false));
        let stream_id = request.stream_id.clone();
        let source_type = request.source_type.clone();
        guard.insert(
            stream_id.clone(),
            ActiveLogProcess {
                stream_id: stream_id.clone(),
                child: child.clone(),
                requested_stop: requested.clone(),
            },
        );
        drop(guard);

        let _ = app.emit(
            "log://started",
            LogStreamStartedEvent {
                stream_id: stream_id.clone(),
                received_at: now_ms(),
            },
        );
        let mut readers = Vec::new();
        if let Some(out) = stdout {
            readers.push(spawn_stdout_reader(
                out,
                log_tx.clone(),
                stream_id.clone(),
                source_type,
                self.seq.clone(),
                debug,
            ));
        }
        if let Some(err) = stderr {
            readers.push(spawn_stderr_reader(
                err,
                app.clone(),
                stream_id.clone(),
                debug,
            ));
        }

        let app2 = app.clone();
        let sid = stream_id.clone();
        thread::spawn(move || {
            let status = loop {
                match child.lock().unwrap().try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => thread::sleep(Duration::from_millis(25)),
                    Err(_) => break None,
                }
            };
            for reader in readers {
                let _ = reader.join();
            }
            let requested_stop = requested.load(Ordering::SeqCst);
            let code = status.as_ref().and_then(|s| s.code());
            #[cfg(unix)]
            let signal = status
                .as_ref()
                .and_then(|s| s.signal())
                .map(|s| s.to_string());
            #[cfg(not(unix))]
            let signal = None;
            if debug {
                eprintln!("[klogcat debug] stream {sid} exited: code={code:?} signal={signal:?} requested_stop={requested_stop}");
            }

            if let Some(state) = app2.try_state::<LogProcessState>() {
                if let Some(tx) = state.merge_sender() {
                    let (ack_tx, ack_rx) = mpsc::channel();
                    if tx
                        .send(MergeMessage::StreamEnded {
                            stream_id: sid.clone(),
                            ack: ack_tx,
                        })
                        .is_ok()
                    {
                        if ack_rx
                            .recv_timeout(Duration::from_millis(STREAM_FLUSH_ACK_TIMEOUT_MS))
                            .is_err()
                            && debug
                        {
                            eprintln!(
                                "[klogcat debug] timed out waiting for merge flush ack for {sid}"
                            );
                        }
                    } else if debug {
                        eprintln!("[klogcat debug] failed to request merge flush for {sid}");
                    }
                }
                let mut g = state.active.lock().unwrap();
                g.remove(&sid);
                if debug {
                    eprintln!(
                        "[klogcat debug] stream {sid} removed from active map before exit emit"
                    );
                }
            }

            let _ = app2.emit(
                "log://exit",
                LogStreamExitEvent {
                    stream_id: sid.clone(),
                    exit_code: code,
                    signal,
                    requested_stop,
                },
            );
        });
        Ok(())
    }

    pub fn stop(&self, stream_id: &str) -> Result<(), CommandError> {
        if debug_enabled() {
            eprintln!("[klogcat debug] stopping stream {stream_id}");
        }
        let active = {
            let mut guard = self.active.lock().unwrap();
            let Some(active) = guard.get(stream_id) else {
                return Err(CommandError::new("stream_not_found", "stream not found"));
            };
            active.requested_stop.store(true, Ordering::SeqCst);
            guard.remove(stream_id).unwrap()
        };

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut sent_kill = false;
        loop {
            let mut child = active.child.lock().unwrap();
            match child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) => {
                    if !sent_kill || Instant::now() >= deadline {
                        let _ = child.kill();
                        sent_kill = true;
                    }
                }
                Err(e) => {
                    return Err(
                        CommandError::new("stream_stop_failed", "failed to stop stream")
                            .with_details(e.to_string()),
                    )
                }
            }
            drop(child);
            if Instant::now() >= deadline {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(25));
        }
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

#[cfg(test)]
mod mocked_process {
    use super::*;

    fn request() -> StartLogStreamRequest {
        StartLogStreamRequest {
            stream_id: "s".into(),
            context: Some("ctx".into()),
            namespace: "ns".into(),
            pod: "pod-1".into(),
            container: "c".into(),
            source_type: "app".into(),
            file_path: "/x".into(),
            initial_tail_lines: 1,
        }
    }

    fn env(stream_id: &str, raw: &str, received_at: u128, seq: u64) -> LogEnvelope {
        LogEnvelope::new(stream_id.into(), "app".into(), raw.into(), received_at, seq)
    }

    #[test]
    fn validation_rejects_relative_path() {
        let mut r = request();
        r.file_path = "rel".into();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn validation_rejects_bad_source_type_and_kube_names() {
        let mut r = request();
        r.source_type = "debug".into();
        assert!(validate(&r).is_err());
        let mut r = request();
        r.namespace = "Bad_Ns".into();
        assert!(validate(&r).is_err());
        let mut r = request();
        r.pod = "-bad".into();
        assert!(validate(&r).is_err());
    }

    #[test]
    fn order_time_prefers_log_time() {
        assert_eq!(order_time_ms(Some(100), 200), 100);
    }
    #[test]
    fn order_time_falls_back_to_received_at() {
        assert_eq!(order_time_ms(None, 200), 200);
    }
    #[test]
    fn extract_log_time_supports_iso_prefix() {
        assert!(extract_log_time_ms("2026-06-24T07:42:45.123Z hello").is_some());
    }
    #[test]
    fn extract_log_time_supports_space_prefix() {
        assert!(extract_log_time_ms("2026-06-24 07:42:45.123 hello").is_some());
    }
    #[test]
    fn extract_log_time_supports_bracket_space_prefix() {
        assert!(extract_log_time_ms("[2026-06-24 07:42:45.123] hello").is_some());
    }
    #[test]
    fn extract_log_time_returns_none_for_raw_line() {
        assert_eq!(extract_log_time_ms("hello without timestamp"), None);
    }
    #[test]
    fn extract_log_time_supports_json_epoch_time_ms() {
        assert_eq!(
            extract_log_time_ms(r#"{"epochTime":1719214965123,"message":"x"}"#),
            Some(1719214965123)
        );
    }
    #[test]
    fn extract_log_time_supports_json_epoch_time_seconds() {
        assert_eq!(
            extract_log_time_ms(r#"{"timestamp":1719214965,"message":"x"}"#),
            Some(1719214965000)
        );
    }
    #[test]
    fn extract_log_time_supports_json_time_string() {
        assert!(
            extract_log_time_ms(r#"{"time":"2026-06-24T07:42:45.123Z","message":"x"}"#).is_some()
        );
    }
    #[test]
    fn extract_log_time_supports_json_at_timestamp_string() {
        assert!(
            extract_log_time_ms(r#"{"@timestamp":"2026-06-24T07:42:45.123Z","message":"x"}"#)
                .is_some()
        );
    }

    #[test]
    fn heap_pops_older_order_time_first() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s", "2026-06-24T07:42:46.000Z newer", 1, 1)));
        heap.push(QueuedLog(env("s", "2026-06-24T07:42:45.000Z older", 2, 2)));
        assert!(heap.pop().unwrap().0.raw.contains("older"));
    }
    #[test]
    fn heap_ties_by_received_at_then_seq() {
        let mut a = env("s", "raw", 2, 2);
        a.order_time_ms = 10;
        let mut b = env("s", "raw", 1, 99);
        b.order_time_ms = 10;
        let mut c = env("s", "raw", 1, 1);
        c.order_time_ms = 10;
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(a));
        heap.push(QueuedLog(b));
        heap.push(QueuedLog(c));
        assert_eq!(heap.pop().unwrap().0.seq, 1);
        assert_eq!(heap.pop().unwrap().0.seq, 99);
        assert_eq!(heap.pop().unwrap().0.seq, 2);
    }
    #[test]
    fn timestampless_line_uses_received_at() {
        let e = env("s", "raw", 123, 1);
        assert_eq!(e.log_time_ms, None);
        assert_eq!(e.order_time_ms, 123);
    }

    #[test]
    fn zero_window_flushes_available_logs_in_sorted_order() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s", "b", 20, 2)));
        heap.push(QueuedLog(env("s", "a", 10, 1)));
        let out = drain_flushable(&mut heap, 20, 20, 0, 10);
        assert_eq!(
            out.into_iter().map(|e| e.raw).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
    }
    #[test]
    fn reorder_window_holds_recent_log() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s", "a", 900, 1)));
        assert!(drain_flushable(&mut heap, 1000, 1000, 1000, 10).is_empty());
    }
    #[test]
    fn max_batch_size_is_respected() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s", "a", 1, 1)));
        heap.push(QueuedLog(env("s", "b", 2, 2)));
        assert_eq!(drain_flushable(&mut heap, 2, 2, 0, 1).len(), 1);
    }
    #[test]
    fn wall_clock_age_flushes_quiet_streams() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s", "a", 1000, 1)));
        assert_eq!(drain_flushable(&mut heap, 1000, 2500, 1000, 10).len(), 1);
    }
    #[test]
    fn stream_ended_drains_only_that_stream() {
        let mut heap = BinaryHeap::new();
        heap.push(QueuedLog(env("s1", "b", 20, 2)));
        heap.push(QueuedLog(env("s2", "x", 5, 3)));
        heap.push(QueuedLog(env("s1", "a", 10, 1)));
        let out = drain_stream(&mut heap, "s1", 10);
        assert_eq!(
            out.into_iter().map(|e| e.raw).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert_eq!(heap.len(), 1);
        assert_eq!(heap.pop().unwrap().0.stream_id, "s2");
    }
}
