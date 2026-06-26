import type { ConfiguredKlogcatExtensionModule } from './logViewerExtensionLoader'

// Build-time extension discovery point.
// Add trusted extension packages here after importing their exported klogcatExtension module.
export const configuredLogViewerExtensions: readonly ConfiguredKlogcatExtensionModule[] = []
