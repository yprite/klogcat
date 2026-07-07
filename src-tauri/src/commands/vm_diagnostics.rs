use super::{vm::shell_quote, vm_target_groups::EffectiveVmProfile};
use crate::{error::CommandError, settings::AwsVmTargetPluginSettings};

pub(super) fn profile_label(profile: &EffectiveVmProfile) -> String {
    [
        profile.bastion_name.as_deref().unwrap_or("shared-bastion"),
        profile.module_name.as_deref().unwrap_or("default-module"),
    ]
    .join(" / ")
}

pub(crate) fn append_diagnostics(error: CommandError, diagnostics: &[String]) -> CommandError {
    if diagnostics.is_empty() {
        return error;
    }
    let CommandError {
        code,
        message,
        details,
        validation_errors,
    } = error;
    let details = details
        .map(|details| format!("{details}\n{}", diagnostics.join("\n")))
        .unwrap_or_else(|| diagnostics.join("\n"));
    let mut next = CommandError::new(code, message).with_details(details);
    next.validation_errors = validation_errors;
    next
}

pub(crate) fn redact_command(command: &str, plugin: &AwsVmTargetPluginSettings) -> String {
    let mut redacted = command.to_string();
    for secret in [
        plugin.bastion_password.as_str(),
        plugin.vm_password.as_str(),
        plugin.bastion_totp_secret.as_deref().unwrap_or_default(),
    ] {
        if !secret.is_empty() {
            redacted = redacted.replace(secret, "[redacted]");
            redacted = redacted.replace(&shell_quote(secret), "'[redacted]'");
        }
    }
    redacted
}
