import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon, RotateCcw } from "lucide-react";

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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <div className="panel max-w-lg p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400">
              <AlertOctagon size={22} />
            </div>
            <h1 className="text-lg font-semibold text-white">Something went wrong in the interface</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <button
              className="btn-primary mt-6"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              <RotateCcw size={16} />
              Reload the studio
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
