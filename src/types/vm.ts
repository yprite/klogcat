import type { SourceLogType } from './log'

export type AwsVmTargetPluginSettings = {
  enabled: boolean
  bastionHost: string
  bastionPort: number
  bastionUsername: string
  bastionPasswordEnv: string
  bastionTotpSecretEnv?: string
  bastionPasswordMode: 'password' | 'password-plus-totp'
  vmUsername: string
  vmPasswordEnv: string
  consulCatalogCommand: string
  strictHostKeyChecking: boolean
  logPaths: Record<SourceLogType, string>
}

export type CsvFileTargetPluginSettings = {
  enabled: boolean
  csvText: string
}

export type TargetPluginSettings = {
  awsVm: AwsVmTargetPluginSettings
  csvFile: CsvFileTargetPluginSettings
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
