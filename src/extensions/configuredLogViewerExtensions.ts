import type { ConfiguredKlogcatExtensionModule } from './logViewerExtensionLoader'
import { apiFlowGraphExtensionModule } from './examples/ApiFlowGraphExtension'

// Build-time extension discovery point.
// Add trusted extension packages here after importing their exported klogcatExtension module.
export const configuredLogViewerExtensions: readonly ConfiguredKlogcatExtensionModule[] = [
  { module: apiFlowGraphExtensionModule, order: 10 },
]
