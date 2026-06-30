use crate::error::CommandError;

pub(crate) fn validate_bastion_username(value: &str) -> Result<(), CommandError> {
    if is_ssh_username(value) {
        return Ok(());
    }
    Err(CommandError::new(
        "vm_plugin_config_invalid",
        "bastionUsername must be a safe SSH username",
    ))
}

pub(crate) fn validate_vm_username(value: &str) -> Result<(), CommandError> {
    if is_ssh_username(value) || is_ssh_email_username(value) {
        return Ok(());
    }
    Err(CommandError::new(
        "vm_plugin_config_invalid",
        "vmUsername must be a safe SSH username or email account",
    ))
}

fn is_ssh_username(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphanumeric() || first == '.' || first == '_')
        && value.len() <= 64
        && !value.contains('@')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

fn is_ssh_email_username(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    is_safe_email_local(local) && is_safe_email_domain(domain)
}

fn is_safe_email_local(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '%' | '+' | '-'))
}

fn is_safe_email_domain(value: &str) -> bool {
    value.contains('.') && value.split('.').all(is_safe_email_label)
}

fn is_safe_email_label(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    value.len() <= 63
        && first.is_ascii_alphanumeric()
        && !value.ends_with('-')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}
