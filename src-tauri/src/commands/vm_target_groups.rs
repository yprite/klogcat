use crate::commands::vm::VmTargetInfo;
use crate::settings::{
    AwsVmTargetGroupSettings, AwsVmTargetModuleSettings, AwsVmTargetPluginSettings,
};

#[derive(Debug, Clone)]
pub(super) struct EffectiveVmProfile {
    pub plugin: AwsVmTargetPluginSettings,
    pub bastion_id: Option<String>,
    pub bastion_name: Option<String>,
    pub module_id: Option<String>,
    pub module_name: Option<String>,
}

pub(super) fn effective_vm_profiles(plugin: &AwsVmTargetPluginSettings) -> Vec<EffectiveVmProfile> {
    if plugin.target_groups.is_empty() {
        return vec![EffectiveVmProfile {
            plugin: without_target_groups(plugin),
            bastion_id: None,
            bastion_name: None,
            module_id: None,
            module_name: None,
        }];
    }
    plugin
        .target_groups
        .iter()
        .filter(|group| group.enabled)
        .flat_map(|group| effective_group_profiles(plugin, group))
        .collect()
}

fn effective_group_profiles(
    plugin: &AwsVmTargetPluginSettings,
    group: &AwsVmTargetGroupSettings,
) -> Vec<EffectiveVmProfile> {
    let group_plugin = apply_group_overrides(plugin, group);
    if group.modules.is_empty() {
        return vec![profile_for_group(group_plugin, group, None)];
    }
    group
        .modules
        .iter()
        .map(|module| {
            profile_for_group(
                apply_module_overrides(&group_plugin, module),
                group,
                Some(module),
            )
        })
        .collect()
}

fn profile_for_group(
    plugin: AwsVmTargetPluginSettings,
    group: &AwsVmTargetGroupSettings,
    module: Option<&AwsVmTargetModuleSettings>,
) -> EffectiveVmProfile {
    EffectiveVmProfile {
        plugin,
        bastion_id: Some(group.id.clone()),
        bastion_name: Some(group.name.clone()),
        module_id: module.map(|module| module.id.clone()),
        module_name: module.map(|module| module.name.clone()),
    }
}

fn without_target_groups(plugin: &AwsVmTargetPluginSettings) -> AwsVmTargetPluginSettings {
    let mut next = plugin.clone();
    next.target_groups.clear();
    next
}

fn non_empty(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .filter(|item| !item.trim().is_empty())
        .cloned()
}

fn apply_group_overrides(
    plugin: &AwsVmTargetPluginSettings,
    group: &AwsVmTargetGroupSettings,
) -> AwsVmTargetPluginSettings {
    let mut next = without_target_groups(plugin);
    next.enabled = plugin.enabled && group.enabled;
    apply_optional_string(&mut next.bastion_host, &group.bastion_host);
    if let Some(value) = group.bastion_port {
        next.bastion_port = value;
    }
    apply_optional_string(&mut next.bastion_username, &group.bastion_username);
    apply_optional_string(&mut next.bastion_password, &group.bastion_password);
    if let Some(value) = non_empty(&group.bastion_totp_secret) {
        next.bastion_totp_secret = Some(value);
    }
    apply_optional_string(
        &mut next.bastion_password_mode,
        &group.bastion_password_mode,
    );
    apply_optional_string(&mut next.vm_username, &group.vm_username);
    apply_optional_string(&mut next.vm_password, &group.vm_password);
    apply_optional_string(
        &mut next.consul_catalog_command,
        &group.consul_catalog_command,
    );
    if let Some(value) = group.strict_host_key_checking {
        next.strict_host_key_checking = value;
    }
    next.log_paths.extend(group.log_paths.clone());
    next
}

fn apply_optional_string(target: &mut String, value: &Option<String>) {
    if let Some(value) = non_empty(value) {
        *target = value;
    }
}

fn apply_module_overrides(
    plugin: &AwsVmTargetPluginSettings,
    module: &AwsVmTargetModuleSettings,
) -> AwsVmTargetPluginSettings {
    let mut next = without_target_groups(plugin);
    if let Some(value) = non_empty(&module.consul_catalog_command) {
        next.consul_catalog_command = value;
    } else {
        next.consul_catalog_command = format!("consul_catalog {}", module.name);
    }
    next.log_paths.extend(module.log_paths.clone());
    next
}

pub(super) fn annotate_vm_target(
    mut target: VmTargetInfo,
    profile: &EffectiveVmProfile,
) -> VmTargetInfo {
    if let Some(bastion_id) = &profile.bastion_id {
        let module_part = profile.module_id.as_deref().unwrap_or("default");
        target.id = format!("{bastion_id}:{module_part}:{}", target.id);
        target.bastion_id = profile.bastion_id.clone();
        target.bastion_name = profile.bastion_name.clone();
        target.module_id = profile.module_id.clone();
        target.module_name = profile.module_name.clone();
    }
    target
}

pub(super) fn discovery_error_details(profile: &EffectiveVmProfile, stderr: &str) -> String {
    let label = [
        profile.bastion_name.as_deref(),
        profile.module_name.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" / ");
    if label.is_empty() {
        stderr.to_string()
    } else if stderr.is_empty() {
        format!("target group: {label}")
    } else {
        format!("target group: {label}\n{stderr}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_vm_target_groups_and_modules() {
        let mut plugin = crate::settings::default_settings().plugins.targets.aws_vm;
        plugin.enabled = true;
        plugin.bastion_username = "ops".into();
        plugin.bastion_password = "bastion-password".into();
        plugin.vm_username = "app@example.com".into();
        plugin.vm_password = "vm-password".into();
        plugin.target_groups = vec![AwsVmTargetGroupSettings {
            id: "prod".into(),
            name: "Prod".into(),
            enabled: true,
            bastion_host: Some("bastion-prod.example.com".into()),
            bastion_port: None,
            bastion_username: None,
            bastion_password: None,
            bastion_totp_secret: None,
            bastion_password_mode: None,
            vm_username: None,
            vm_password: None,
            consul_catalog_command: None,
            strict_host_key_checking: None,
            log_paths: Default::default(),
            modules: vec![AwsVmTargetModuleSettings {
                id: "api".into(),
                name: "API".into(),
                consul_catalog_command: Some(
                    "consul catalog nodes -service api -format=json".into(),
                ),
                log_paths: Default::default(),
            }],
        }];

        let profiles = effective_vm_profiles(&plugin);
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].plugin.bastion_host, "bastion-prod.example.com");
        assert_eq!(
            profiles[0].plugin.consul_catalog_command,
            "consul catalog nodes -service api -format=json"
        );
        let target = annotate_vm_target(
            VmTargetInfo {
                id: "api-1".into(),
                name: "api-1".into(),
                address: "10.0.0.7".into(),
                service: None,
                datacenter: None,
                tags: None,
                bastion_id: None,
                bastion_name: None,
                module_id: None,
                module_name: None,
            },
            &profiles[0],
        );
        assert_eq!(target.id, "prod:api:api-1");
        assert_eq!(target.bastion_name.as_deref(), Some("Prod"));
        assert_eq!(target.module_name.as_deref(), Some("API"));
    }
}
