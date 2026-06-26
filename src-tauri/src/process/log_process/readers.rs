use super::*;
use crate::process::line_splitter::LineSplitter;
use std::{
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::Sender,
        Arc,
    },
    thread::{self, JoinHandle},
};
use tauri::Emitter;

pub(super) fn spawn_stdout_reader<R: Read + Send + 'static>(
    reader: R,
    log_tx: Sender<MergeMessage>,
    stream_id: String,
    source_type: String,
    seq: Arc<AtomicU64>,
    debug: bool,
) -> JoinHandle<()> {
    spawn_reader_loop(reader, move |line| {
        send_stdout_line(&log_tx, &seq, &stream_id, &source_type, line, debug);
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

pub(super) fn spawn_stderr_reader<R: Read + Send + 'static, T: tauri::Runtime>(
    reader: R,
    app: tauri::AppHandle<T>,
    stream_id: String,
    debug: bool,
) -> JoinHandle<()> {
    spawn_reader_loop(reader, move |line| {
        emit_stderr(&app, &stream_id, line, debug);
    })
}

fn spawn_reader_loop<R: Read + Send + 'static, F>(mut reader: R, mut on_line: F) -> JoinHandle<()>
where
    F: FnMut(String) + Send + 'static,
{
    thread::spawn(move || {
        let mut splitter = LineSplitter::new();
        let mut buf = [0u8; 8192];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(bytes_read) => emit_lines(bytes_read, &mut splitter, &mut buf, &mut on_line),
                Err(_) => break,
            }
        }
        if let Some(line) = splitter.flush() {
            on_line(line);
        }
    })
}

fn emit_lines<F: FnMut(String)>(
    bytes_read: usize,
    splitter: &mut LineSplitter,
    buf: &mut [u8; 8192],
    on_line: &mut F,
) {
    for line in splitter.push(&buf[..bytes_read]) {
        on_line(line);
    }
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
