/** 어시스턴트 API. 정본 specs/07-architecture/10-AI-어시스턴트.md
 *
 *  보내기만 `api()` 래퍼를 안 쓴다. 답이 JSON 한 덩이가 아니라 **흘러오기** 때문이다.
 *  대신 같은 토큰을 붙이고 401 이면 한 번 갱신해 다시 시도한다(래퍼와 같은 어법). */
import { api, refresh } from "../../shared/api/client";
import { useAuth } from "../../shared/store/auth";

export interface Chat { id: number; title: string | null; updated_at: string }

/** 답 한 통은 조각 목록이다(§8-1). 글·부품·되물음이 섞인다.
 *  다시 열면 부품은 **지금 값**으로 그리고 글자는 그때 그대로 남는다. */
export type Piece =
  | { t: "text"; v: string }
  | { t: "ui"; name: string; props: Record<string, unknown> }
  | { t: "ask"; question: string; options: string[] };

export interface ToolLog { name: string; input: Record<string, unknown>; ms: number; summary: string; error: string | null }

export interface Msg {
  id: number; seq: number; role: "user" | "assistant";
  content: Piece[]; tool_calls: ToolLog[] | null; created_at: string;
}

/** 흘러오는 것 — 서버가 던지는 조각. 오류 문구는 ref.error_msg 에서 온다(서버가 문장을 안 짓는다) */
export type Ev =
  | { t: "start"; seq: number }
  | { t: "delta"; v: string }
  | { t: "tool"; phase: "start"; id: string; name: string; input: Record<string, unknown> }
  | { t: "tool"; phase: "end"; id: string; name: string; ms: number; summary: string }
  | { t: "ui"; name: string; props: Record<string, unknown> }
  | { t: "ask"; question: string; options: string[] }
  | { t: "error"; code: string; title: string; body: string | null; action: string | null; level: string }
  | { t: "done"; message_id: number | null; title: string | null; stop: string;
      scrubbed: string[] | null; tok_in: number; tok_out: number };

export const chats = {
  list: () => api<Chat[]>("/ai/chats"),
  create: () => api<Chat>("/ai/chats", { method: "POST" }),
  rename: (id: number, title: string) =>
    api<{ ok: true }>(`/ai/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  remove: (id: number) => api<void>(`/ai/chats/${id}`, { method: "DELETE" }),
  messages: (id: number) => api<Msg[]>(`/ai/chats/${id}`),
};

/** 한 통 보내고 조각을 흘려 받는다. `signal` 로 중간에 세울 수 있다 —
 *  잘못 시킨 것을 끝까지 보고 있어야 하면 안 된다. */
export async function send(
  chatId: number, text: string, on: (e: Ev) => void, signal?: AbortSignal, retry = true,
): Promise<void> {
  const access = useAuth.getState().access;
  const res = await fetch(`/api/ai/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ text }),
    credentials: "include",
    signal,
  });
  if (res.status === 401 && retry) {
    const t = await refresh();
    if (t) return send(chatId, text, on, signal, false);
    useAuth.getState().clear();
    return;
  }
  if (!res.ok || !res.body) {
    on({ t: "error", code: "AI_UPSTREAM_DOWN", title: "지금은 답할 수 없습니다",
         body: "잠시 뒤 다시 시도해 주세요.", action: "retry", level: "warn" });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // SSE 는 빈 줄로 한 덩이가 끝난다. 반쪽만 온 덩이는 버퍼에 남긴다
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try { on(JSON.parse(line.slice(6))); } catch { /* 반쪽 덩이는 조용히 버린다 */ }
    }
  }
}
