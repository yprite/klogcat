use crate::error::CommandError;
use crate::process::line_splitter::LineSplitter;
use serde::{Deserialize, Serialize};
use std::{
    env,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartLogStreamRequest {
    pub stream_id: String,
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

pub struct ActiveLogProcess {
    pub stream_id: String,
    pub child: Arc<Mutex<Child>>,
    pub requested_stop: Arc<AtomicBool>,
}
pub struct LogProcessState {
    pub active: Mutex<Option<ActiveLogProcess>>,
}
impl Default for LogProcessState {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
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

fn spawn_reader<R: Read + Send + 'static, T: tauri::Runtime>(
    mut reader: R,
    app: tauri::AppHandle<T>,
    stream_id: String,
    source_type: Option<String>,
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
                        if let Some(st) = &source_type {
                            if debug {
                                eprintln!("[klogcat debug] stdout {stream_id} {st}: {line}");
                            }
                            let _ = app.emit(
                                "log://line",
                                LogLineEvent {
                                    stream_id: stream_id.clone(),
                                    source_type: st.clone(),
                                    raw: line,
                                    received_at: now_ms(),
                                },
                            );
                        } else {
                            if debug {
                                eprintln!("[klogcat debug] stderr {stream_id}: {line}");
                            }
                            let _ = app.emit(
                                "log://stderr",
                                LogStreamStderrEvent {
                                    stream_id: stream_id.clone(),
                                    line,
                                    received_at: now_ms(),
                                },
                            );
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(line) = sp.flush() {
            if let Some(st) = source_type {
                if debug {
                    eprintln!("[klogcat debug] stdout {stream_id} {st}: {line}");
                }
                let _ = app.emit(
                    "log://line",
                    LogLineEvent {
                        stream_id,
                        source_type: st,
                        raw: line,
                        received_at: now_ms(),
                    },
                );
            } else {
                if debug {
                    eprintln!("[klogcat debug] stderr {stream_id}: {line}");
                }
                let _ = app.emit(
                    "log://stderr",
                    LogStreamStderrEvent {
                        stream_id,
                        line,
                        received_at: now_ms(),
                    },
                );
            }
        }
    })
}

impl LogProcessState {
    pub fn start<R: tauri::Runtime>(
        &self,
        app: tauri::AppHandle<R>,
        request: StartLogStreamRequest,
    ) -> Result<(), CommandError> {
        validate(&request)?;
        let mut guard = self.active.lock().unwrap();
        if guard.is_some() {
            return Err(CommandError::new(
                "stream_already_running",
                "a log stream is already running",
            ));
        }
        let tail_n = request.initial_tail_lines.to_string();
        let debug = debug_enabled();
        let args = [
            "exec",
            "-n",
            &request.namespace,
            &request.pod,
            "-c",
            &request.container,
            "--",
            "tail",
            "-n",
            &tail_n,
            "-F",
            &request.file_path,
        ];
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
        *guard = Some(ActiveLogProcess {
            stream_id: stream_id.clone(),
            child: child.clone(),
            requested_stop: requested.clone(),
        });
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
            readers.push(spawn_reader(
                out,
                app.clone(),
                stream_id.clone(),
                Some(source_type),
                debug,
            ));
        }
        if let Some(err) = stderr {
            readers.push(spawn_reader(
                err,
                app.clone(),
                stream_id.clone(),
                None,
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
                eprintln!(
                    "[klogcat debug] stream {sid} exited: code={code:?} signal={signal:?} requested_stop={requested_stop}"
                );
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
            if let Some(state) = app2.try_state::<LogProcessState>() {
                let mut g = state.active.lock().unwrap();
                if g.as_ref().map(|a| a.stream_id.as_str()) == Some(sid.as_str()) {
                    *g = None;
                }
            }
        });
        Ok(())
    }

    pub fn stop(&self, stream_id: &str) -> Result<(), CommandError> {
        if debug_enabled() {
            eprintln!("[klogcat debug] stopping stream {stream_id}");
        }
        let active = {
            let mut guard = self.active.lock().unwrap();
            let Some(active) = guard.as_ref() else {
                return Err(CommandError::new("stream_not_found", "stream not found"));
            };
            if active.stream_id != stream_id {
                return Err(CommandError::new("stream_not_found", "stream not found"));
            }
            active.requested_stop.store(true, Ordering::SeqCst);
            guard.take().unwrap()
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
        let active = self.active.lock().unwrap().take();
        if let Some(active) = active {
            active.requested_stop.store(true, Ordering::SeqCst);
            let _ = active.child.lock().unwrap().kill();
        }
    }
}

#[cfg(test)]
mod mocked_process {
    use super::*;

    fn request() -> StartLogStreamRequest {
        StartLogStreamRequest {
            stream_id: "s".into(),
            namespace: "ns".into(),
            pod: "pod-1".into(),
            container: "c".into(),
            source_type: "app".into(),
            file_path: "/x".into(),
            initial_tail_lines: 1,
        }
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
}
