import type { KlogcatExtensionModule, LogViewerExtensionProps } from '../../../sdk/log-viewer'

function LatencyPackageViewer({ snapshot }: LogViewerExtensionProps) {
  return <section>External fixture rows: {snapshot.visibleRowCount}</section>
}

export const klogcatExtension: KlogcatExtensionModule = {
  manifest: {
    id: 'fixture.latency',
    ownerId: 'fixture',
    protocol: { name: 'klogcat.logViewer', version: 1 },
    label: 'Fixture Latency',
    description: 'External package fixture that uses only the public SDK',
    requestedCapabilities: ['logs.read'],
    trustLevel: 'trusted-bundled',
  },
  activate(host) {
    return host.registerLogViewer({
      id: 'fixture.latency',
      ownerId: 'fixture',
      label: 'Fixture Latency',
      description: 'External package fixture that uses only the public SDK',
      component: LatencyPackageViewer,
      requestedCapabilities: ['logs.read'],
      trustLevel: 'trusted-bundled',
    })
  },
}
