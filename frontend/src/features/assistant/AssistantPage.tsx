/** AI 어시스턴트 — 2단계(도구). 정본 specs/07-architecture/10-AI-어시스턴트.md
 *
 *  1단계는 도구 없이 그냥 대화였다. 2단계에서 답 안에 **우리 부품**이 선다 —
 *  건물 카드는 누르면 건물 상세로, 찾은 목록은 검색 화면과 같은 줄로. 이게 없으면
 *  앱 안에 챗지피티 창을 붙인 것뿐이다(§13). 되물음은 칩으로 뜨고 고르면 그 글자가 다음 말이 된다.
 *
 *  왼쪽은 대화 목록, 오른쪽은 한 대화. 대화는 **개인**이라 팀원 것은 안 보인다.
 *  입력은 pill 한 줄이고 조작은 아이콘이다(줄마다 네모버튼을 나열하지 않는다). */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Icon } from "../../shared/ui/Icon";
import { Loading } from "../../shared/ui/Spinner";
import { chats, send, type Chat, type Ev, type Msg, type Piece, type ToolLog } from "./api";
import { Pieces, Tools } from "./Message";
import "./assistant.css";

/** 빈 화면에 놓는 문장 넷. 「이런 걸 물어보세요」 같은 안내가 아니라
 *  누르면 그대로 들어가는 문장 자체다(설명글씨 금지) */
const SEEDS = [
  "성수동1가에서 연면적 200평 넘는 건물 찾아줘",
  "삼성동 78 어떤 건물이야",
  "성수동2가 1층 업체 많은 건물은",
  "구별로 건물 수 세어줘",
];

interface Err { code: string; title: string; body: string | null; action: string | null }

export function AssistantPage() {
  const qc = useQueryClient();
  const [cur, setCur] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["ai-chats"], queryFn: chats.list });
  const drop = useMutation({
    mutationFn: chats.remove,
    onSuccess: (_d, id) => { qc.invalidateQueries({ queryKey: ["ai-chats"] }); if (cur === id) setCur(null); },
  });

  return (
    <div className="as">
      <aside className="as-l">
        <div className="as-lh">
          <span>대화</span>
          <button className="as-new" title="새 대화" onClick={() => setCur(null)}><Icon name="plus" size={14} /></button>
        </div>
        {list.isLoading && <Loading label="불러오는 중" minHeight="20vh" />}
        {(list.data ?? []).map((c) => (
          <Row key={c.id} c={c} on={cur === c.id} pick={() => setCur(c.id)}
            drop={() => { if (confirm("이 대화를 지울까요?")) drop.mutate(c.id); }} />
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

/** 흘러오는 답 한 통의 상태. 끝나면 서버 것으로 갈아탄다 */
interface Live { pieces: Piece[]; log: ToolLog[]; running: string | null;
                 /** 지금 도는 도구에 무엇을 보냈나 — end 에서 기록에 붙인다 */
                 sent?: Record<string, unknown> | null }
const EMPTY: Live = { pieces: [], log: [], running: null, sent: null };

/** 오른쪽 한 판. 대화를 아직 안 골랐어도 **입력줄은 늘 서 있다** —
 *  「먼저 새 대화를 누르세요」를 시키면 한 걸음이 더 는다. 치면 그때 만들어진다. */
function Pane({ chatId, onCreated }: { chatId: number | null; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  /** 지금 보고 있는 대화. 부모의 `chatId` 를 따라가되 **우리가 방금 만든 것은 무시한다.**
   *  예전엔 부모가 `key={cur}` 로 이 부품을 다시 태어나게 했는데, 첫 문장을 칠 때
   *  대화가 만들어지면서 키가 바뀌어 흘러오던 답과 오류가 통째로 지워졌다. */
  const [id, setId] = useState<number | null>(chatId);
  const q = useQuery({ queryKey: ["ai-msgs", id], queryFn: () => chats.messages(id as number), enabled: id != null });
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [note, setNote] = useState<string | null>(null);     // 가린 것이 있으면 화면이 말한다(§15)
  const abort = useRef<AbortController | null>(null);
  const foot = useRef<HTMLDivElement>(null);
  const busy = live != null;

  useEffect(() => { foot.current?.scrollIntoView({ block: "end" }); }, [q.data, live]);
  useEffect(() => {
    if (chatId === id) return;
    setId(chatId); setLive(null); setErr(null); setNote(null); setDraft("");
  }, [chatId]);

  async function go(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setDraft(""); setErr(null); setNote(null); setLive(EMPTY);
    let cid = id;
    if (cid == null) {
      const c = await chats.create();
      cid = c.id; setId(c.id);
      qc.invalidateQueries({ queryKey: ["ai-chats"] });
      onCreated(c.id);
    }
    // 내가 친 것은 곧바로 선다. 서버 응답을 기다리지 않는다
    qc.setQueryData<Msg[]>(["ai-msgs", cid], (old) => [
      ...(old ?? []),
      { id: -Date.now(), seq: ((old && old.length ? old[old.length - 1].seq : 0)) + 1, role: "user",
        content: [{ t: "text", v: t }], tool_calls: null, created_at: new Date().toISOString() },
    ]);
    const ac = new AbortController();
    abort.current = ac;
    let acc = "";                                  // 흘러오는 글. 도구가 끼면 조각으로 굳힌다
    const L: Live = { pieces: [], log: [], running: null };
    const flush = () => { if (acc.trim()) { L.pieces = [...L.pieces, { t: "text", v: acc }]; acc = ""; } };
    const push = () => setLive({ ...L, pieces: acc ? [...L.pieces, { t: "text", v: acc }] : L.pieces });
    try {
      await send(cid, t, (e: Ev) => {
        if (e.t === "delta") { acc += e.v; push(); }
        // **무엇을 보냈는지도 화면에 남긴다.** input 을 비워 보내니 「모델이 무엇을 물었길래
        // 이 답이 나왔나」를 화면에서 못 봤다. start 의 인자를 붙들었다가 end 에 붙인다(2026-09-09 대표)
        else if (e.t === "tool" && e.phase === "start") { flush(); L.running = e.name; L.sent = e.input ?? {}; push(); }
        else if (e.t === "tool") { L.log = [...L.log, { name: e.name, input: L.sent ?? {}, ms: e.ms, summary: e.summary, error: null }]; L.running = null; L.sent = null; push(); }
        else if (e.t === "ui") { flush(); L.pieces = [...L.pieces, { t: "ui", name: e.name, props: e.props }]; push(); }
        else if (e.t === "ask") { flush(); L.pieces = [...L.pieces, { t: "ask", question: e.question, options: e.options }]; push(); }
        else if (e.t === "error") setErr(e);
        else if (e.t === "done") {
          if (e.title) qc.invalidateQueries({ queryKey: ["ai-chats"] });
          if (e.scrubbed?.length) setNote(`가린 것: ${e.scrubbed.join(" · ")}`);
        }
      }, ac.signal);
    } catch { /* 중단은 오류가 아니다 */ }
    abort.current = null;
    // 서버 것을 **먼저** 받고 나서 흘러오던 것을 내린다. 반대로 하면 그 틈에 답이 잠깐 사라진다
    await qc.invalidateQueries({ queryKey: ["ai-msgs", cid] });
    setLive(null);
  }

  if (id != null && q.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const msgs = q.data ?? [];
  const empty = msgs.length === 0 && live == null && !err;
  const last = msgs.length ? msgs[msgs.length - 1] : null;

  return (
    <>
      <div className={`as-msgs ${empty ? "blank" : ""}`}>
        {empty && (
          <div className="as-seeds">
            {SEEDS.map((t) => <button key={t} onClick={() => go(t)}>{t}</button>)}
          </div>
        )}
        {msgs.map((m) => m.role === "user"
          ? <div className="as-m user" key={m.id}>{m.content.filter((p) => p.t === "text").map((p) => (p as { v: string }).v).join("\n")}</div>
          : (
            <div className="as-a" key={m.id}>
              {m.tool_calls && <Tools log={m.tool_calls} />}
              {/* 되물음 칩은 **마지막 답에서만** 눌린다. 지나간 되물음에 답하면 문맥이 꼬인다 */}
              <Pieces pieces={m.content} onPick={m === last && !busy ? go : undefined} />
            </div>
          ))}
        {live && (
          <div className="as-a">
            <Tools log={live.log} running={live.running} />
            <Pieces pieces={live.pieces} live />
          </div>
        )}
        {note && <div className="as-note">{note}</div>}
        {err && (
          <div className="as-err"><b>{err.title}</b>{err.body && <span>{err.body}</span>}</div>
        )}
        <div ref={foot} />
      </div>

      <div className="as-in">
        <textarea
          value={draft} rows={1} placeholder="무엇이든 물어보세요"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(draft); }
          }} />
        {busy
          ? <button className="as-go stop" title="멈춤" onClick={() => abort.current?.abort()}><span className="sq" /></button>
          : <button className="as-go" title="보냄" disabled={!draft.trim()} onClick={() => go(draft)}><Icon name="send" size={15} /></button>}
      </div>
    </>
  );
}
