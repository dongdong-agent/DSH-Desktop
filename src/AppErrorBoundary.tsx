import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * 全局错误边界：渲染失败时显示错误详情（而不是黑屏），
 * 便于排查生产环境的加载/运行问题。
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error("[AppErrorBoundary]", error, info);
    try {
      localStorage.setItem("dsh-error", `${error.message}\n${info.componentStack ?? ""}`);
    } catch {
      /* noop */
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            height: "100vh",
            width: "100vw",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            background: "rgb(10 10 12)",
            color: "rgb(248 113 113)",
            fontFamily: "Consolas, monospace",
            fontSize: 13,
            padding: 40,
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 28 }}>⚠️</div>
          <div style={{ fontWeight: 600 }}>应用渲染失败</div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "50vh",
              overflow: "auto",
              background: "rgb(20 20 24)",
              border: "1px solid rgb(255 255 255 / 0.08)",
              borderRadius: 8,
              padding: 12,
              color: "rgb(248 113 113)",
              lineHeight: 1.6,
            }}
          >
            {this.state.error.message}
            {"\n\n"}
            {this.state.info?.componentStack ?? ""}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "rgb(168 85 247)",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 20px",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
