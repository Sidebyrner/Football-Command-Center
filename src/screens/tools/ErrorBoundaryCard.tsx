import { Component, type ReactNode } from 'react'
import { ErrorState } from '@ui/components/State'

/** A tool that throws shows a card, not a blank page. */
export class ErrorBoundaryCard extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {}
  static getDerivedStateFromError(error: Error) { return { error } }
  override render() {
    if (this.state.error) return <ErrorState message={this.state.error.message} onRetry={() => this.setState({ error: undefined })} />
    return this.props.children
  }
}
