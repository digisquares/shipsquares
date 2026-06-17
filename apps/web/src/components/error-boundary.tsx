import { Component, type ErrorInfo, type ReactNode } from "react";

// Top-level error boundary: a render error shows a branded recover screen
// instead of a white page (25-design-system.md — never a dead end). Reuses the
// auth-card styles.
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error boundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen auth-bg">
        <div className="auth-card" role="alert">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">ShipSquares</span>
          </div>
          <h1 className="auth-title">Something went wrong</h1>
          <p className="auth-sub">
            An unexpected error broke this view. Reloading usually fixes it.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
