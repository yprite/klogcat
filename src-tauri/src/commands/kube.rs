use crate::error::CommandError;
use serde::Serialize;
use serde_json::Value;
use std::{io, process::Command};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NamespaceInfo {
    pub name: String,
}
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListNamespacesResponse {
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
    pub namespace: String,
    pub pods: Vec<PodInfo>,
}

struct Output {
    status: i32,
    stdout: String,
    stderr: String,
}
fn run_kubectl(args: &[&str]) -> Result<Output, CommandError> {
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
#[tauri::command]
pub async fn get_current_context() -> Result<String, CommandError> {
    let o = run_kubectl(&["config", "current-context"])?;
    if o.status != 0 {
        return Err(
            CommandError::new("current_context_failed", "failed to get current context")
                .with_details(o.stderr),
        );
    }
    Ok(o.stdout.trim().to_string())
}
#[tauri::command]
pub async fn list_namespaces() -> Result<ListNamespacesResponse, CommandError> {
    let o = run_kubectl(&["get", "namespaces", "-o", "json"])?;
    if o.status != 0 {
        return Err(
            CommandError::new("list_namespaces_failed", "failed to list namespaces")
                .with_details(o.stderr),
        );
    }
    parse_namespaces_json(&o.stdout)
}
#[tauri::command]
pub async fn list_pods(namespace: String) -> Result<ListPodsResponse, CommandError> {
    let o = run_kubectl(&["get", "pods", "-n", &namespace, "-o", "json"])?;
    if o.status != 0 {
        return Err(
            CommandError::new("list_pods_failed", "failed to list pods").with_details(o.stderr)
        );
    }
    parse_pods_json(&namespace, &o.stdout)
}

pub fn parse_namespaces_json(input: &str) -> Result<ListNamespacesResponse, CommandError> {
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
    Ok(ListNamespacesResponse { namespaces })
}
pub fn parse_pods_json(namespace: &str, input: &str) -> Result<ListPodsResponse, CommandError> {
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
        namespace: namespace.into(),
        pods,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn namespaces_skip_missing() {
        let r = parse_namespaces_json(r#"{"items":[{"metadata":{"name":"default"}},{}]}"#).unwrap();
        assert_eq!(r.namespaces.len(), 1);
    }
    #[test]
    fn pods_extract() {
        let r=parse_pods_json("ns", r#"{"items":[{"metadata":{"name":"p"},"status":{"phase":"Running"},"spec":{"containers":[{"name":"app"}]}}]}"#).unwrap();
        assert_eq!(r.pods[0].containers, vec!["app"]);
    }
}
