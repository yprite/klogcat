use super::*;
use crate::kubectl::kubectl_binary;
use std::process::{Command, Stdio};

pub(super) fn kubectl_tail_args(request: &StartLogStreamRequest) -> Vec<String> {
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
        request.initial_tail_lines.to_string(),
        "-F".to_string(),
        request.file_path.clone(),
    ]);
    args
}

pub(super) fn spawn_kubectl_tail(args: &[String]) -> Result<Child, CommandError> {
    Command::new(kubectl_binary())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            CommandError::new("stream_spawn_failed", "failed to spawn kubectl exec tail")
                .with_details(e.to_string())
        })
}

pub(super) fn insert_active_process(
    active: &mut HashMap<String, ActiveLogProcess>,
    stream_id: &str,
    child: Arc<Mutex<Child>>,
    requested_stop: Arc<AtomicBool>,
) {
    active.insert(
        stream_id.to_string(),
        ActiveLogProcess {
            stream_id: stream_id.to_string(),
            child,
            requested_stop,
        },
    );
}

pub(super) fn emit_stream_started<R: tauri::Runtime>(app: &tauri::AppHandle<R>, stream_id: &str) {
    let _ = app.emit(
        "log://started",
        LogStreamStartedEvent {
            stream_id: stream_id.to_string(),
            received_at: now_ms(),
        },
    );
}

pub(super) fn spawn_stream_readers<R: tauri::Runtime>(
    child: &mut Child,
    app: tauri::AppHandle<R>,
    log_tx: Sender<MergeMessage>,
    stream_id: &str,
    source_type: &str,
    seq: Arc<AtomicU64>,
    debug: bool,
) -> Vec<JoinHandle<()>> {
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(spawn_stdout_reader(
            out,
            log_tx,
            stream_id.to_string(),
            source_type.to_string(),
            seq,
            debug,
        ));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(spawn_stderr_reader(err, app, stream_id.to_string(), debug));
    }
    readers
}

pub(super) fn spawn_exit_watcher<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    stream_id: String,
    child: Arc<Mutex<Child>>,
    requested: Arc<AtomicBool>,
    readers: Vec<JoinHandle<()>>,
    debug: bool,
) {
    thread::spawn(move || {
        let status = wait_for_child_exit(&child);
        for reader in readers {
            let _ = reader.join();
        }
        let requested_stop = requested.load(Ordering::SeqCst);
        let code = status.as_ref().and_then(|s| s.code());
        let signal = unix_signal(status.as_ref());
        if debug {
            eprintln!("[klogcat debug] stream {stream_id} exited: code={code:?} signal={signal:?} requested_stop={requested_stop}");
        }

        flush_stream_before_exit(&app, &stream_id, debug);
        let _ = app.emit(
            "log://exit",
            LogStreamExitEvent {
                stream_id,
                exit_code: code,
                signal,
                requested_stop,
            },
        );
    });
}

fn wait_for_child_exit(child: &Arc<Mutex<Child>>) -> Option<std::process::ExitStatus> {
    loop {
        match child.lock().unwrap().try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(_) => break None,
        }
    }
}

fn unix_signal(status: Option<&std::process::ExitStatus>) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.and_then(|s| s.signal()).map(|s| s.to_string())
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}

fn flush_stream_before_exit<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    stream_id: &str,
    debug: bool,
) {
    let Some(state) = app.try_state::<LogProcessState>() else {
        return;
    };
    if let Some(tx) = state.merge_sender() {
        request_stream_flush(&tx, stream_id, debug);
    }
    let mut guard = state.active.lock().unwrap();
    guard.remove(stream_id);
    if debug {
        eprintln!("[klogcat debug] stream {stream_id} removed from active map before exit emit");
    }
}

fn request_stream_flush(tx: &Sender<MergeMessage>, stream_id: &str, debug: bool) {
    let (ack_tx, ack_rx) = mpsc::channel();
    let sent = tx.send(MergeMessage::StreamEnded {
        stream_id: stream_id.to_string(),
        ack: ack_tx,
    });
    if sent.is_err() {
        if debug {
            eprintln!("[klogcat debug] failed to request merge flush for {stream_id}");
        }
        return;
    }
    if ack_rx
        .recv_timeout(Duration::from_millis(STREAM_FLUSH_ACK_TIMEOUT_MS))
        .is_err()
        && debug
    {
        eprintln!("[klogcat debug] timed out waiting for merge flush ack for {stream_id}");
    }
}
