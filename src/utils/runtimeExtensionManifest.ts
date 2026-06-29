export type RuntimeExtensionManifest = { id?: unknown; name?: unknown; protocol?: unknown; entry?: unknown }
export type ExtensionManifestValidation = { ok: true } | { ok: false; reason: 'malformed_manifest' | 'unsupported_protocol' }

const SUPPORTED_PROTOCOL = 'klogcat.logViewer@1'

export function validateExtensionManifest(manifest: RuntimeExtensionManifest): ExtensionManifestValidation {
  if (typeof manifest.id !== 'string' || typeof manifest.name !== 'string' || typeof manifest.protocol !== 'string' || typeof manifest.entry !== 'string') {
    return { ok: false, reason: 'malformed_manifest' }
  }
  if (manifest.protocol !== SUPPORTED_PROTOCOL) return { ok: false, reason: 'unsupported_protocol' }
  return { ok: true }
}
