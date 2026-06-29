use std::env;

pub(crate) fn kubectl_binary() -> String {
    kubectl_binary_from_env(env::var("KLOGCAT_KUBECTL_BIN").ok())
}

pub(crate) fn kubectl_binary_from_env(value: Option<String>) -> String {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "kubectl".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kubectl_binary_from_env_prefers_custom_path() {
        assert_eq!(
            kubectl_binary_from_env(Some("/custom/kubectl".to_string())),
            "/custom/kubectl"
        )
    }

    #[test]
    fn kubectl_binary_from_env_falls_back_on_empty() {
        assert_eq!(kubectl_binary_from_env(Some("   ".to_string())), "kubectl")
    }

    #[test]
    fn kubectl_binary_from_env_falls_back_on_none() {
        assert_eq!(kubectl_binary_from_env(None), "kubectl")
    }
}
