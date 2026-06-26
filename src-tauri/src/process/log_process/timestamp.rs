use chrono::{DateTime, NaiveDateTime, Utc};

pub(super) fn order_time_ms(log_time_ms: Option<u128>, received_at: u128) -> u128 {
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
    let number_keys = ["epochTime", "timestamp"];
    for key in number_keys {
        if let Some(ms) = extract_json_time_number(&value, key) {
            return Some(ms);
        }
    }
    let string_keys = ["time", "@timestamp"];
    for key in string_keys {
        if let Some(ms) = extract_json_time_string(&value, key) {
            return Some(ms);
        }
    }
    None
}

fn extract_json_time_number(value: &serde_json::Value, key: &str) -> Option<u128> {
    let Some(number) = value.get(key).and_then(|entry| entry.as_f64()) else {
        return None;
    };
    epoch_number_to_ms(number)
}

fn extract_json_time_string(value: &serde_json::Value, key: &str) -> Option<u128> {
    let Some(raw) = value.get(key).and_then(|entry| entry.as_str()) else {
        return None;
    };
    parse_time_string_ms(raw)
}

/// Extracts a timestamp used for backend ordering only. Timezone-less prefixes are interpreted as UTC.
pub(super) fn extract_log_time_ms(raw: &str) -> Option<u128> {
    let trimmed = raw.trim_start();
    if trimmed.starts_with('{') {
        if let Some(ms) = extract_json_log_time_ms(trimmed) {
            return Some(ms);
        }
    }
    let body = trimmed.strip_prefix('[').unwrap_or(trimmed);
    parse_prefix_timestamp(body)
}

fn parse_prefix_timestamp(body: &str) -> Option<u128> {
    const PREFIX_LENGTHS: [usize; 3] = [24, 23, 19];
    PREFIX_LENGTHS.iter().find_map(|len| {
        (body.len() >= *len)
            .then(|| parse_time_string_ms(&body[..*len]))
            .flatten()
    })
}
