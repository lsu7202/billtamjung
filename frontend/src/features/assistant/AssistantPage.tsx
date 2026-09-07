/** AI 어시스턴트 — 1단계(뼈대). 정본 specs/07-architecture/10-AI-어시스턴트.md
 *
 *  도구가 하나도 없다. **그냥 대화가 된다.** 2단계에서 도구·SQL이 붙으면 우리 것이 되고,
 *  3단계에서 답 안의 건물이 칩이 되어 화면으로 이어진다.
 *
 *  왼쪽은 대화 목록, 오른쪽은 한 대화. 대화는 **개인**이라 팀원 것은 안 보인다.
 *  입력은 pill 한 줄이고 조작은 아이콘이다(줄마다 네모버튼을 나열하지 않는다). */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../shared/ui/Icon";
import { Loading } from "../../shared/ui/Spinner";
import { chats, send, type Chat, type Ev, type Msg } from "./api";
import "./assistant.css";

/** 빈 화면에 놓는 문장 넷. 「이런 걸 물어보세요」 같은 안내가 아니라
 *  누르면 그대로 들어가는 문장 자체다(설명글씨 금지) */
const SEEDS = [
  "성수동 대로변 상가 찾아줘",
  "삼성동 78 어떤 건물이야",
  "요즘 성수동 실거래 어때",
  "이 주소 등기부 정리해줘",
];

interface Err { code: string; title: string; body: string | null; action: string | null }

export function AssistantPage() {
  const qc = useQueryClient();
  const [cur, setCur] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["ai-chats"], queryFn: chats.list });

  const make = useMutation({
    mutationFn: chats.create,
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["ai-chats"] }); setCur(c.id); },
  });
  const drop = useMutation({
    mutationFn: chats.remove,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["ai-chats"] });
      if (cur === id) setCur(null);
    },
  });

  return (
    <div className="as">
      <aside className="as-l">
        <div className="as-lh">
          <span>대화</span>
          <button className="as-new" title="새 대화" onClick={() => make.mutate()}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        {list.isLoading && <Loading label="불러오는 중" minHeight="20vh" />}
        {(list.data ?? []).map((c) => (
          <Row key={c.id} c={c} on={cur === c.id} pick={() => setCur(c.id)} drop={() => {
            if (confirm("이 대화를 지울까요?")) drop.mutate(c.id);
          }} />
        ))}
      </aside>

      <section className="as-r">
        <Pane chatId={cur} onCreated={setCur} />
      </section>
    </div>
  );
}

function Row({ c, on, pick, drop }: { c: Chat; on: boolean; pick: () => void; drop: () => void }) {
  return (
    <div className={`as-i ${on ? "on" : ""}`} onClick={pick}>
      <span className="tx">{c.title ?? <i className="off">새 대화</i>}</span>
      <button className="as-x" title="지움" onClick={(e) => { e.stopPropagation(); drop(); }}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

/** 오른쪽 한 판. 대화를 아직 안 골랐어도 **입력줄은 늘 서 있다** —
 *  「먼저 새 대화를 누르세요」를 시키면 한 걸음이 더 는다. 치면 그때 만들어진다. */
function Pane({ chatId, onCreated }: { chatId: number | null; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  /** 지금 보고 있는 대화. 부모의 `chatId` 를 따라가되 **우리가 방금 만든 것은 무시한다.**
   *
   *  예전엔 부모가 `key={cur}` 로 이 부품을 다시 태어나게 했는데, 첫 문장을 칠 때
   *  대화가 만들어지면서 키가 바뀌어 **흘러오던 답과 오류가 통째로 지워졌다.**
   *  키를 빼고, 바뀐 것이 남이 고른 대화일 때만 상태를 비운다. */
  const [id, setId] = useState<number | null>(chatId);
  const q = useQuery({
    queryKey: ["ai-msgs", id], queryFn: () => chats.messages(id as number),
    enabled: id != null,
  });
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<string | null>(null);   // 흘러오는 중인 답
  const [err, setErr] = useState<Err | null>(null);
  const abort = useRef<AbortController | null>(null);
  const foot = useRef<HTMLDivElement>(null);
  const busy = live != null;

  useEffect(() => { foot.current?.scrollIntoView({ block: "end" }); }, [q.data, live]);
  useEffect(() => {
    if (chatId === id) return;              // 우리가 만든 것 — 아무것도 안 한다
    setId(chatId); setLive(null); setErr(null); setDraft("");
  }, [chatId]);

  async function go(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setDraft(""); setErr(null); setLive("");
    // 대화가 없으면 지금 만든다. 사용자는 「새 대화」를 누른 적이 없다
    let cid = id;
    if (cid == null) {
      const c = await chats.create();
      cid = c.id;
      setId(c.id);
      qc.invalidateQueries({ queryKey: ["ai-chats"] });
      onCreated(c.id);
    }
    // 내가 친 것은 곧바로 선다. 서버 응답을 기다리지 않는다
    qc.setQueryData<Msg[]>(["ai-msgs", cid], (old) => [
      ...(old ?? []),
      { id: -Date.now(), seq: ((old && old.length ? old[old.length - 1].seq : 0)) + 1, role: "user",
        content: [{ t: "text", v: t }], created_at: new Date().toISOString() },
    ]);
    const ac = new AbortController();
    abort.current = ac;
    let acc = "";
    try {
      await send(cid, t, (e: Ev) => {
        if (e.t === "delta") { acc += e.v; setLive(acc); }
        else if (e.t === "error") setErr(e);
        else if (e.t === "done") {
          if (e.title) qc.invalidateQueries({ queryKey: ["ai-chats"] });
        }
      }, ac.signal);
    } catch { /* 중단은 오류가 아니다 */ }
    abort.current = null;
    setLive(null);
    qc.invalidateQueries({ queryKey: ["ai-msgs", cid] });
  }

  if (id != null && q.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const msgs = q.data ?? [];
  const empty = msgs.length === 0 && live == null && !err;

  return (
    <>
      <div className={`as-msgs ${empty ? "blank" : ""}`}>
        {empty && (
          <div className="as-seeds">
            {SEEDS.map((t) => <button key={t} onClick={() => go(t)}>{t}</button>)}
          </div>
        )}
        {msgs.map((m) => {
          const text = m.content.filter((p) => p.t === "text").map((p) => p.v).join("\n").trim();
          if (!text) return null;
          return <div className={`as-m ${m.role}`} key={m.id}>{text}</div>;
        })}
        {live != null && <div className="as-m assistant">{live || <span className="as-dots" />}</div>}
        {err && (
          <div className="as-err">
            <b>{err.title}</b>
            {err.body && <span>{err.body}</span>}
          </div>
        )}
        <div ref={foot} />
      </div>

      <div className="as-in">
        <textarea
          value={draft} rows={1} placeholder="무엇이든 물어보세요"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault(); go(draft);
            }
          }} />
        {busy
          ? <button className="as-go stop" title="멈춤" onClick={() => abort.current?.abort()}>
              <span className="sq" />
            </button>
          : <button className="as-go" title="보냄" disabled={!draft.trim()} onClick={() => go(draft)}>
              <Icon name="send" size={15} />
            </button>}
      </div>
    </>
  );
}
