import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackMessage?: string
  onReset?: () => void
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100dvh',
          background: '#1a3a2a',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 24,
        }}>
          <span style={{ fontSize: 32 }}>&#x1F635;</span>
          <h2 style={{ color: '#e2b858', fontSize: 18, fontWeight: 700, margin: 0 }}>
            Something went wrong
          </h2>
          <p style={{ color: '#a8d0a8', fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
            {this.props.fallbackMessage ?? 'An unexpected error occurred. Try again.'}
          </p>
          {this.state.error && (
            <p style={{ color: '#3a5a3a', fontSize: 10, textAlign: 'center', maxWidth: 300 }}>
              {this.state.error.message}
            </p>
          )}
          <button
            onClick={this.handleReset}
            style={{
              background: '#e2b858',
              border: 'none',
              borderRadius: 12,
              padding: '12px 32px',
              color: '#2c1810',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
