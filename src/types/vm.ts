import type { SourceLogType } from './log'

export type AwsVmTargetModuleSettings = {
  id: string
  name: string
  consulCatalogCommand?: string
  logPaths?: Partial<Record<SourceLogType, string>>
}

export type AwsVmTargetGroupSettings = {
  id: string
  name: string
  enabled: boolean
  bastionHost?: string
  bastionPort?: number
  bastionUsername?: string
  bastionPassword?: string
  bastionTotpSecret?: string
  bastionPasswordMode?: 'password' | 'password-plus-totp'
  vmUsername?: string
  vmPassword?: string
  consulCatalogCommand?: string
  strictHostKeyChecking?: boolean
  logPaths?: Partial<Record<SourceLogType, string>>
  modules: AwsVmTargetModuleSettings[]
}

export type AwsVmTargetPluginSettings = {
  enabled: boolean
  bastionHost: string
  bastionPort: number
  bastionUsername: string
  bastionPassword: string
  bastionTotpSecret?: string
  bastionPasswordMode: 'password' | 'password-plus-totp'
  vmUsername: string
  vmPassword: string
  consulCatalogCommand: string
  strictHostKeyChecking: boolean
  logPaths: Record<SourceLogType, string>
  targetGroups: AwsVmTargetGroupSettings[]
}

export type TargetPluginSettings = {
  awsVm: AwsVmTargetPluginSettings
}

export type VmTargetInfo = {
  id: string
  name: string
  address: string
  service?: string
  datacenter?: string
  tags?: string[]
  bastionId?: string
  bastionName?: string
  moduleId?: string
  moduleName?: string
}

export type ListVmTargetsResponse = {
  targets: VmTargetInfo[]
}

export type VmLogStreamConfig = {
  target: VmTargetInfo
  plugin: AwsVmTargetPluginSettings
}
