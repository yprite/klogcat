use crate::error::CommandError;
use serde::Serialize;
use serde_json::Value;
use std::{io, process::Command};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextInfo {
    pub name: String,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListContextsResponse {
    pub contexts: Vec<ContextInfo>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceInfo {
    pub name: String,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListNamespacesResponse {
    pub context: Option<String>,
    pub namespaces: Vec<NamespaceInfo>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PodInfo {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub containers: Vec<String>,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListPodsResponse {
    pub context: Option<String>,
    pub namespace: String,
    pub pods: Vec<PodInfo>,
}

struct Output {
    status: i32,
    stdout: String,
    stderr: String,
}
fn run_kubectl(args: &[String]) -> Result<Output, CommandError> {
    let output = Command::new("kubectl").args(args).output().map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            CommandError::new("kubectl_not_found", "kubectl was not found")
        } else {
            CommandError::new("current_context_failed", "failed to run kubectl")
                .with_details(e.to_string())
        }
    })?;
    Ok(Output {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}
fn context_args(context: Option<&str>) -> Vec<String> {
    context
        .filter(|c| !c.trim().is_empty())
        .map(|c| vec!["--context".into(), c.into()])
        .unwrap_or_default()
}
#[tauri::command]
pub async fn get_current_context() -> Result<String, CommandError> {
    let o = run_kubectl(&["config".into(), "current-context".into()])?;
    if o.status != 0 {
        return Err(
            CommandError::new("current_context_failed", "failed to get current context")
                .with_details(o.stderr),
        );
    }
    Ok(o.stdout.trim().to_string())
}
#[tauri::command]
pub async fn list_contexts() -> Result<ListContextsResponse, CommandError> {
    let o = run_kubectl(&[
        "config".into(),
        "get-contexts".into(),
        "-o".into(),
        "name".into(),
    ])?;
    if o.status != 0 {
        return Err(
            CommandError::new("list_contexts_failed", "failed to list contexts")
                .with_details(o.stderr),
        );
    }
    Ok(ListContextsResponse {
        contexts: o
            .stdout
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| ContextInfo { name: name.into() })
            .collect(),
    })
}
#[tauri::command]
pub async fn list_namespaces(
    context: Option<String>,
) -> Result<ListNamespacesResponse, CommandError> {
    let mut args = context_args(context.as_deref());
    args.extend([
        "get".into(),
        "namespaces".into(),
        "-o".into(),
        "json".into(),
    ]);
    let o = run_kubectl(&args)?;
    if o.status != 0 {
        return Err(
            CommandError::new("list_namespaces_failed", "failed to list namespaces")
                .with_details(o.stderr),
        );
    }
    let mut response = parse_namespaces_json(context.clone(), &o.stdout)?;
    response.namespaces =
        filter_namespaces_with_pod_access(context.as_deref(), response.namespaces)?;
    Ok(response)
}
#[tauri::command]
pub async fn list_pods(
    namespace: String,
    context: Option<String>,
) -> Result<ListPodsResponse, CommandError> {
    let mut args = context_args(context.as_deref());
    args.extend([
        "get".into(),
        "pods".into(),
        "-n".into(),
        namespace.clone(),
        "-o".into(),
        "json".into(),
    ]);
    let o = run_kubectl(&args)?;
    if o.status != 0 {
        return Err(
            CommandError::new("list_pods_failed", "failed to list pods").with_details(o.stderr)
        );
    }
    parse_pods_json(context, &namespace, &o.stdout)
}

pub fn parse_namespaces_json(
    context: Option<String>,
    input: &str,
) -> Result<ListNamespacesResponse, CommandError> {
    let v: Value = serde_json::from_str(input).map_err(|e| {
        CommandError::new("list_namespaces_failed", "invalid namespace json")
            .with_details(e.to_string())
    })?;
    let namespaces = v["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|item| {
            item["metadata"]["name"]
                .as_str()
                .map(|name| NamespaceInfo { name: name.into() })
        })
        .collect();
    Ok(ListNamespacesResponse {
        context,
        namespaces,
    })
}

fn can_list_pods_in_namespace(
    context: Option<&str>,
    namespace: &str,
) -> Result<bool, CommandError> {
    let mut args = context_args(context);
    args.extend([
        "auth".into(),
        "can-i".into(),
        "list".into(),
        "pods".into(),
        "-n".into(),
        namespace.into(),
    ]);
    let o = run_kubectl(&args)?;
    Ok(o.stdout.trim().eq_ignore_ascii_case("yes"))
}

fn filter_namespaces_by_access<F>(
    namespaces: Vec<NamespaceInfo>,
    mut can_access: F,
) -> Vec<NamespaceInfo>
where
    F: FnMut(&str) -> bool,
{
    namespaces
        .into_iter()
        .filter(|namespace| can_access(&namespace.name))
        .collect()
}

fn filter_namespaces_with_pod_access(
    context: Option<&str>,
    namespaces: Vec<NamespaceInfo>,
) -> Result<Vec<NamespaceInfo>, CommandError> {
    let mut error: Option<CommandError> = None;
    let filtered = filter_namespaces_by_access(namespaces, |namespace| {
        match can_list_pods_in_namespace(context, namespace) {
            Ok(can_access) => can_access,
            Err(e) => {
                error = Some(e);
                false
            }
        }
    });
    if let Some(e) = error {
        Err(e)
    } else {
        Ok(filtered)
    }
}

pub fn parse_pods_json(
    context: Option<String>,
    namespace: &str,
    input: &str,
) -> Result<ListPodsResponse, CommandError> {
    let v: Value = serde_json::from_str(input).map_err(|e| {
        CommandError::new("list_pods_failed", "invalid pods json").with_details(e.to_string())
    })?;
    let pods = v["items"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|item| {
            let name = item["metadata"]["name"].as_str()?;
            let phase = item["status"]["phase"]
                .as_str()
                .unwrap_or("Unknown")
                .to_string();
            let containers = item["spec"]["containers"]
                .as_array()
                .unwrap_or(&Vec::new())
                .iter()
                .filter_map(|c| c["name"].as_str().map(String::from))
                .collect();
            Some(PodInfo {
                name: name.into(),
                namespace: namespace.into(),
                phase,
                containers,
            })
        })
        .collect();
    Ok(ListPodsResponse {
        context,
        namespace: namespace.into(),
        pods,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn namespaces_skip_missing() {
        let r = parse_namespaces_json(
            Some("ctx".into()),
            r#"{"items":[{"metadata":{"name":"default"}},{}]}"#,
        )
        .unwrap();
        assert_eq!(r.context, Some("ctx".into()));
        assert_eq!(r.namespaces.len(), 1);
    }
    #[test]
    fn pods_extract() {
        let r=parse_pods_json(Some("ctx".into()), "ns", r#"{"items":[{"metadata":{"name":"p"},"status":{"phase":"Running"},"spec":{"containers":[{"name":"app"}]}}]}"#).unwrap();
        assert_eq!(r.context, Some("ctx".into()));
        assert_eq!(r.pods[0].containers, vec!["app"]);
    }

    #[test]
    fn namespace_access_filter_keeps_only_allowed_namespaces() {
        let namespaces = vec![
            NamespaceInfo {
                name: "default".into(),
            },
            NamespaceInfo {
                name: "kube-system".into(),
            },
            NamespaceInfo {
                name: "team-a".into(),
            },
        ];
        let filtered =
            filter_namespaces_by_access(namespaces, |namespace| namespace != "kube-system");
        assert_eq!(
            filtered,
            vec![
                NamespaceInfo {
                    name: "default".into()
                },
                NamespaceInfo {
                    name: "team-a".into()
                },
            ]
        );
    }
}
