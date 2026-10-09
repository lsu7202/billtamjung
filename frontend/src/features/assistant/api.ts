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
  | { t: "ask"; 물음: AskItem[] }
  | { t: "file"; id: number; name: string | null }          // 내 말과 함께 올린 이미지(0237)
  | { t: "ui" | "next"; [k: string]: unknown };           // 옛 대화에 남은 조각 — 안 그린다

/** 되물음 하나. `고르기` 가 없어도 사용자는 직접 칠 수 있다(2026-09-25) */
export interface AskItem { 묻는것: string; 고르기?: string[] | null; 여러개?: boolean }

export interface ToolLog { name: string; input: Record<string, unknown>; ms: number; summary: string; error: string | null }

/** 도구가 돌려준 건물 하나의 좌표. **화면 지도용**이라 모델에게는 안 간다(2026-09-21).
 *  나대지면 `pk` 가 19자리 pnu 다. */
export interface Pin {
  /** pk = 모델이 가리킨 건물(나대지면 지번) · pnu = 지도에서 고르는 열쇠(지번) */
  pk: string; pnu: string; vacant: boolean; addr: string; lng: number; lat: number; col: "mine" | "ad" | "market" | "normal";   // 출처(11b)
  /** price = 그 건물 1번 매물의 매매가(0226). 없으면 null · 추정가는 sale_est */
  sale_est: number | null; price: number | null; land_area: number | null; total_area: number | null;
}

/** 오른쪽 판 열기(0235) — 컨테이너 하나 · 한 번에 한 화면. **핀이 있다고 열지 않는다.**
 *  map = 모델의 지도 도구가 고른 땅(pks) · artifact = 만든 · 고친 자료 · templates = 도구 모음에서 「자료 만들기」 */
export type Panel =
  | { view: "map"; pks: string[]; focus?: string | null }
  | { view: "artifact"; id: number; ver?: number }
  | { view: "templates" };

export interface Msg {
  id: number; seq: number; role: "user" | "assistant";
  content: Piece[]; tool_calls: ToolLog[] | null; created_at: string;
  /** 이 답이 돌려준 건물들 — 본문 건물 카드가 읽는다. 판을 열지는 않는다 */
  pins?: Pin[] | null;
  /** 이 답의 마지막 판 — 다시 열면 이 판이 돌아온다 */
  panel?: Panel | null;
}

/** 자료 템플릿(0235) — 고른 요청에만 실리는 작성 규격 */
export interface Template { key: string; name: string; desc: string; kind: string; size: string; version: number; ready: boolean }

/** 대화에 올리는 이미지(0237) — 자료에 넣는 용도. 파일은 바깥 모델로 안 간다(모델은 번호만 받는다) */
export const uploadsApi = {
  upload: (f: File) => {
    const fd = new FormData(); fd.append("file", f);
    return api<{ id: number; name: string | null }>("/ai/uploads", { method: "POST", body: fd });
  },
};

export const templatesApi = {
  list: () => api<Template[]>("/artifacts/templates"),
};

/** 흘러오는 것 — 서버가 던지는 조각. 오류 문구는 ref.error_msg 에서 온다(서버가 문장을 안 짓는다) */
export type Ev =
  | { t: "start"; seq: number }
  | { t: "delta"; v: string }
  | { t: "tool"; phase: "start"; id: string; name: string; input: Record<string, unknown> }
  | { t: "tool"; phase: "end"; id: string; name: string; ms: number; summary: string }
  | { t: "pins"; items: Pin[] }
  | ({ t: "panel" } & Panel)
  | { t: "ask"; 물음: AskItem[] }
  | { t: "text"; v: string; confidence?: string }
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
  /** 사용자가 고른 자료 템플릿 — 이 말 한 번뿐 */
  template: string | null = null,
  /** 이 말과 함께 올린 이미지 번호 */
  attachments: number[] = [],
): Promise<void> {
  const access = useAuth.getState().access;
  const res = await fetch(`/api/ai/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify({ text, template, attachments }),
    credentials: "include",
    signal,
  });
  if (res.status === 401 && retry) {
    const t = await refresh();
    if (t) return send(chatId, text, on, signal, false, template, attachments);
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
