import { Component, type ReactNode } from "react";

/** 렌더 중 예외가 나면 흰 화면 대신 복구 수단을 보여준다.
 *  실제로 네이버 지도 인증이 실패했을 때 지도 이후 코드가 연쇄로 터지며 화면이 통째로 사라졌다.
 *  (SDK 자체 문제·차단 프로그램·네트워크 등 우리가 못 막는 원인도 있어서 안전망이 필요하다.) */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { err: Error | null }
> {
  state: { err: Error | null } = { err: null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.error("[ErrorBoundary]", err);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        display: "grid", placeContent: "center", gap: 14, minHeight: 320,
        padding: 40, textAlign: "center",
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.02em" }}>
          {this.props.label ?? "화면을 그리는 중 문제가 생겼습니다"}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", maxWidth: 420, lineHeight: 1.7 }}>
          새로고침하면 대부분 해결됩니다. 계속 같은 화면이 나오면 어떤 작업 중이었는지 알려주세요.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="btn primary" onClick={() => location.reload()}>새로고침</button>
          <button className="btn" onClick={() => { location.href = "/search"; }}>건물 검색으로</button>
        </div>
        <details style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)" }}>
          <summary style={{ cursor: "pointer" }}>오류 내용</summary>
          <pre style={{ textAlign: "left", whiteSpace: "pre-wrap", marginTop: 8, fontSize: 11 }}>
            {String(this.state.err?.message ?? this.state.err)}
          </pre>
        </details>
      </div>
    );
  }
}
