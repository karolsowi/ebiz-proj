import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary.
 * Catches unhandled React render errors and shows a user-friendly message
 * instead of a blank screen. Wrap the app root with this component.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // In production this would go to Sentry / DataDog / similar
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Navigate to home as a safe recovery point
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-5xl">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Something went wrong
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              An unexpected error occurred. The development console has more details.
            </p>
            {import.meta.env.DEV && this.state.error && (
              <pre className="text-left bg-gray-100 dark:bg-gray-800 rounded p-3 text-xs text-red-600 dark:text-red-400 overflow-auto max-h-40">
                {this.state.error.message}
                {"\n"}
                {this.state.error.stack}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="inline-block bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
            >
              Go to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
