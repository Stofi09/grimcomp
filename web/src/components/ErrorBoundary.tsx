import { Component, type ErrorInfo, type ReactNode } from 'react';
import './ErrorBoundary.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  // When this value changes (e.g. the user navigates to another screen or
  // switches characters) a caught error is dropped so the freshly-mounted
  // content gets a chance to render — recovery without a full page reload.
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Class component because error boundaries have no Hooks equivalent:
// getDerivedStateFromError + componentDidCatch are class-only React APIs.
//
// Deliberately content-agnostic. The app imports hand-edited / homebrew JSON
// content packs and grimcomp.v1 data exports, so a malformed character,
// overlay, or pack (a field that should be a number arriving as an object,
// say) can make a screen throw mid-render. Without a boundary that throw
// unmounts the whole React root and white-screens the app. This catches it at
// the screen level and keeps the rail / app-bar chrome interactive, so the
// user can switch characters or reach Settings to remove the offending pack or
// reset local data.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the component stack for debugging; the fallback only shows the
    // message so the UI stays readable.
    console.error('[ErrorBoundary] screen render failed', error, info.componentStack);
  }

  // Navigating to another screen or switching characters changes resetKey —
  // drop the caught error so the new content renders instead of the fallback.
  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const message = error.message || String(error);

    return (
      <div className="gc-errbnd-scroll">
        <div className="gc-errbnd-content">
          <div className="gc-errbnd-card" role="alert">
            <span className="gc-errbnd-eyebrow">Something went wrong</span>
            <h1 className="gc-errbnd-title">This screen hit an error</h1>
            <p className="gc-errbnd-body">
              The screen couldn&rsquo;t be drawn &mdash; most often this is a
              malformed character, overlay, or content pack. Use the menu to
              switch characters, or open Settings to remove the offending pack
              or reset local data, then try again.
            </p>
            <pre className="gc-errbnd-message">{message}</pre>
            <div className="gc-errbnd-actions">
              <button
                type="button"
                className="btn-reset gc-errbnd-btn gc-errbnd-btn--primary"
                onClick={this.reset}
              >
                Try again
              </button>
              <button
                type="button"
                className="btn-reset gc-errbnd-btn"
                onClick={() => window.location.reload()}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
