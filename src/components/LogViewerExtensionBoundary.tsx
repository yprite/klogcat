import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  extensionLabel: string
  children: ReactNode
}

type State = {
  error?: string
}

export class LogViewerExtensionBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[klogcat extension error]', this.props.extensionLabel, error, info.componentStack)
  }

  componentDidUpdate(previousProps: Props) {
    if (previousProps.extensionLabel !== this.props.extensionLabel && this.state.error) this.setState({ error: undefined })
  }

  render() {
    if (this.state.error) {
      return <section className="min-h-0 flex-1 overflow-auto rounded border border-red-900 bg-red-950 p-4 text-sm text-red-100" role="alert">
        <p className="font-semibold">Extension failed: {this.props.extensionLabel}</p>
        <p className="mt-2 font-mono text-xs">{this.state.error}</p>
      </section>
    }

    return this.props.children
  }
}
