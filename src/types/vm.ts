import type { SourceLogType } from './log'

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
}

export type ListVmTargetsResponse = {
  targets: VmTargetInfo[]
}

export type VmLogStreamConfig = {
  target: VmTargetInfo
  plugin: AwsVmTargetPluginSettings
}
