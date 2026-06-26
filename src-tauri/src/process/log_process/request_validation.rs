use super::StartLogStreamRequest;
use crate::error::CommandError;

pub(super) fn validate(r: &StartLogStreamRequest) -> Result<(), CommandError> {
    validate_required_fields(r)?;
    validate_source_type(&r.source_type)?;
    validate_kubernetes_names(&r.namespace, &r.pod)?;
    validate_log_file_path(&r.file_path)?;
    validate_initial_tail_lines(r.initial_tail_lines)
}

fn validate_required_fields(r: &StartLogStreamRequest) -> Result<(), CommandError> {
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
    Ok(())
}

fn validate_source_type(source_type: &str) -> Result<(), CommandError> {
    if !matches!(source_type, "info" | "access" | "error") {
        return Err(CommandError::new(
            "invalid_source_config",
            "sourceType must be info, access, or error",
        ));
    }
    Ok(())
}

fn validate_kubernetes_names(namespace: &str, pod: &str) -> Result<(), CommandError> {
    if !is_dns_label(namespace) {
        return Err(CommandError::new(
            "invalid_source_config",
            "namespace must be a valid Kubernetes DNS label",
        ));
    }
    if !is_dns_subdomain(pod) {
        return Err(CommandError::new(
            "invalid_source_config",
            "pod must be a valid Kubernetes DNS subdomain",
        ));
    }
    Ok(())
}

fn validate_log_file_path(file_path: &str) -> Result<(), CommandError> {
    if !file_path.starts_with('/') || file_path.contains('\0') {
        return Err(CommandError::new(
            "invalid_source_config",
            "filePath must be absolute and contain no null byte",
        ));
    }
    Ok(())
}

fn validate_initial_tail_lines(initial_tail_lines: u32) -> Result<(), CommandError> {
    if initial_tail_lines > 100000 {
        return Err(CommandError::new(
            "invalid_source_config",
            "initialTailLines must be <= 100000",
        ));
    }
    Ok(())
}

fn is_dns_label(value: &str) -> bool {
    if value.is_empty() || value.len() > 63 {
        return false;
    }
    let bytes = value.as_bytes();
    if !is_dns_label_char(*bytes.first().expect("non-empty")) {
        return false;
    }
    if !is_dns_label_char(*bytes.last().expect("non-empty")) {
        return false;
    }
    bytes.iter().all(is_dns_label_inner_char)
}

fn is_dns_label_inner_char(byte: &u8) -> bool {
    is_dns_label_char(*byte)
}

fn is_dns_label_char(byte: u8) -> bool {
    byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'
}

fn is_dns_subdomain(value: &str) -> bool {
    !value.is_empty() && value.len() <= 253 && value.split('.').all(is_dns_label)
}
