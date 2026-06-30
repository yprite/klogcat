use super::*;

fn request() -> StartLogStreamRequest {
    StartLogStreamRequest {
        stream_id: "s".into(),
        target_kind: None,
        context: Some("ctx".into()),
        namespace: "ns".into(),
        pod: "pod-1".into(),
        container: "c".into(),
        source_type: "info".into(),
        file_path: "/x".into(),
        initial_tail_lines: 1,
        vm: None,
    }
}

fn env(stream_id: &str, raw: &str, received_at: u128, seq: u64) -> LogEnvelope {
    LogEnvelope::new(
        stream_id.into(),
        "info".into(),
        raw.into(),
        received_at,
        seq,
    )
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
    assert!(extract_log_time_ms(r#"{"time":"2026-06-24T07:42:45.123Z","message":"x"}"#).is_some());
}

#[test]
fn extract_log_time_supports_json_at_timestamp_string() {
    assert!(
        extract_log_time_ms(r#"{"@timestamp":"2026-06-24T07:42:45.123Z","message":"x"}"#).is_some()
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
