import type { WorkbenchFeatureFlagName, WorkbenchFeatureFlags } from '../types/settings'

export const workbenchFeatureFlagNames = [
  'workbench.workloadFollow.enabled',
  'workbench.kubernetesContext.enabled',
  'workbench.incidentTriage.enabled',
] as const satisfies readonly WorkbenchFeatureFlagName[]

export const defaultWorkbenchFeatureFlags: WorkbenchFeatureFlags = {
  'workbench.workloadFollow.enabled': false,
  'workbench.kubernetesContext.enabled': false,
  'workbench.incidentTriage.enabled': false,
}

export function resolveWorkbenchFeatureFlags(flags: Partial<WorkbenchFeatureFlags> | undefined): WorkbenchFeatureFlags {
  return { ...defaultWorkbenchFeatureFlags, ...(flags ?? {}) }
}

export function isWorkbenchFeatureFlagName(value: string): value is WorkbenchFeatureFlagName {
  return (workbenchFeatureFlagNames as readonly string[]).includes(value)
}
