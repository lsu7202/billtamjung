/** AI 어시스턴트 — 2단계(도구). 정본 specs/07-architecture/10-AI-어시스턴트.md
 *  (2026-09-30) 빌탐정의 첫 화면. 대화 목록은 레일의 펼친 판으로 옮겼다.
 *
 *  1단계는 도구 없이 그냥 대화였다. 2단계에서 답 안에 **우리 부품**이 선다 —
 *  건물 카드는 누르면 건물 상세로, 찾은 목록은 검색 화면과 같은 줄로. 이게 없으면
 *  앱 안에 챗지피티 창을 붙인 것뿐이다(§13). 되물음은 칩으로 뜨고 고르면 그 글자가 다음 말이 된다.
 *
 *  대화는 **개인**이라 팀원 것은 안 보인다.
 *  입력은 pill 한 줄이고 조작은 아이콘이다(줄마다 네모버튼을 나열하지 않는다). */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { MapPanel, type MapPin } from "../../shared/map/MapPanel";
import { Icon } from "../../shared/ui/Icon";
import { Loading } from "../../shared/ui/Spinner";
import { AskBox } from "./AskBox";
import { chats, send, type AskItem, type Ev, type Msg, type Piece, type Pin, type ToolLog } from "./api";
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
  // 대화 목록은 레일의 펼친 판(☰)으로 옮겼다(2026-09-30) — 이 화면은 대화 하나만 넓게.
  // ?chat=id 면 그 대화, 없으면 새 대화. 새로 만들어지면 주소에 그 번호를 붙인다(목록이 그 대화를 짚게)
  const [sp, setSp] = useSearchParams();
  const [cur, setCur] = useState<number | null>(() => (sp.get("chat") ? Number(sp.get("chat")) : null));
  useEffect(() => { const c = sp.get("chat"); setCur(c ? Number(c) : null); }, [sp]);
  return (
    <div className="as one">
      <section className="as-r">
        <Pane chatId={cur} onCreated={(id) => { setCur(id); setSp({ chat: String(id) }, { replace: true }); }} />
      </section>
    </div>
  );
}

/** 흘러오는 답 한 통의 상태. 끝나면 서버 것으로 갈아탄다 */
interface Live { pieces: Piece[]; log: ToolLog[]; running: string | null;
                 /** 지금 도는 도구에 무엇을 보냈나 — end 에서 기록에 붙인다 */
                 sent?: Record<string, unknown> | null;
                 /** 도구가 돌려준 건물들 — 오른쪽 지도와 본문 카드가 읽는다 */
                 pins: Pin[];
                 /** 되물음. 오면 대화창 위에 상자가 선다 */
                 ask?: AskItem[] | null }
const EMPTY: Live = { pieces: [], log: [], running: null, sent: null, pins: [], ask: null };

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
  /** 대화를 바꿀 때마다 1씩 오른다. 보내는 중인 답은 시작할 때의 값을 쥐고 있다가, 값이 달라졌으면
   *  (사람이 다른 대화로 옮겼으면) 흘러오는 것을 버린다 — 옛 답이 새 판에 서거나, 늦게 만들어진
   *  대화가 사람을 도로 끌고 가지 않게(2026-09-30 검토) */
  const gen = useRef(0);
  const foot = useRef<HTMLDivElement>(null);
  const busy = live != null;
  const nav = useNavigate();
  // 아래 훅들은 이른 return(로딩) **위**에 있어야 한다 — 밑에 두면 첫 렌더에 훅 수가
  // 달라져 「Rendered fewer hooks than expected」 로 판이 죽는다(2026-09-21 화면 확인).
  // 오른쪽 지도의 핀 — 흘러오는 답이 있으면 그것, 아니면 마지막 답의 것
  const lastA = [...(q.data ?? [])].reverse().find((m) => m.role === "assistant");
  const pins: Pin[] = live ? live.pins : (lastA?.pins ?? []);
  const mapPins = useMemo<MapPin[]>(() => pins.map((p) => ({
    building_pk: p.pk, addr: p.addr, lng: p.lng, lat: p.lat, col: p.col,
    price: p.price ?? p.sale_est ?? null, sale_est: p.sale_est, price_is_est: p.price == null,
    land_area: p.land_area, total_area: p.total_area,
  })), [pins]);
  // 핀이 다 보이게. 핀이 바뀔 때만 움직인다 — 사람이 옮긴 지도를 되돌리지 않는다
  const centerReq = useMemo(() => {
    if (!pins.length) return null;
    const xs = pins.map((p) => p.lng), ys = pins.map((p) => p.lat);
    const c = { lng: (Math.min(...xs) + Math.max(...xs)) / 2, lat: (Math.min(...ys) + Math.max(...ys)) / 2 };
    return pins.length === 1 ? { ...c, zoom: 17 }
      : { ...c, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] };
  }, [pins]);
  // 지도는 X 로 닫는다. 다시 여는 건 카드의 로드뷰다 — 누르면 그 건물 필지로 간다(2026-09-22 대표).
  // 새 답이 건물을 돌려주면 전체가 보이게 다시 선다
  const [mapOn, setMapOn] = useState(true);
  const [focus, setFocus] = useState<{ pin: Pin; n: number } | null>(null);   // n: 같은 걸 또 눌러도 움직이게
  const pinKey = pins.map((p) => p.pk).join(",");
  useEffect(() => { setMapOn(true); setFocus(null); }, [pinKey]);
  const focusReq = useMemo(() => focus ? { lng: focus.pin.lng, lat: focus.pin.lat, zoom: 18 } : null, [focus]);
  const onFocus = (pin: Pin) => { setMapOn(true); setFocus((f) => ({ pin, n: (f?.n ?? 0) + 1 })); };
  const openPin = (pk: string) => {
    const p = pins.find((x) => x.pk === pk);
    if (p) nav(p.vacant ? `/parcels/${p.pk}` : `/buildings/${p.pk}`);
  };


  useEffect(() => { foot.current?.scrollIntoView({ block: "end" }); }, [q.data, live]);
  useEffect(() => {
    if (chatId === id) return;
    gen.current += 1;
    abort.current?.abort(); abort.current = null;
    setId(chatId); setLive(null); setErr(null); setNote(null); setDraft("");
  }, [chatId]);

  async function go(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setDraft(""); setErr(null); setNote(null); setLive(EMPTY);
    const my = gen.current;
    const gone = () => gen.current !== my;       // 그사이 다른 대화로 옮겼나
    let cid = id;
    if (cid == null) {
      const c = await chats.create();
      qc.invalidateQueries({ queryKey: ["ai-chats"] });
      if (gone()) return;                          // 옮겼으면 새 대화로 끌고 가지 않는다
      cid = c.id; setId(c.id);
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
    const L: Live = { pieces: [], log: [], running: null, pins: [], ask: null };
    const flush = () => { if (acc.trim()) { L.pieces = [...L.pieces, { t: "text", v: acc }]; acc = ""; } };
    const push = () => setLive({ ...L, pieces: acc ? [...L.pieces, { t: "text", v: acc }] : L.pieces });
    try {
      await send(cid, t, (e: Ev) => {
        if (gone()) return;                        // 옛 대화의 답은 새 판에 안 세운다
        if (e.t === "delta") { acc += e.v; push(); }
        // **무엇을 보냈는지도 화면에 남긴다.** input 을 비워 보내니 「모델이 무엇을 물었길래
        // 이 답이 나왔나」를 화면에서 못 봤다. start 의 인자를 붙들었다가 end 에 붙인다(2026-09-09 대표)
        else if (e.t === "tool" && e.phase === "start") { flush(); L.running = e.name; L.sent = e.input ?? {}; push(); }
        else if (e.t === "tool") { L.log = [...L.log, { name: e.name, input: L.sent ?? {}, ms: e.ms, summary: e.summary, error: null }]; L.running = null; L.sent = null; push(); }
        else if (e.t === "pins") { L.pins = [...L.pins, ...e.items]; push(); }
        else if (e.t === "ask") { L.ask = e.물음; push(); }
        else if (e.t === "error") setErr(e);
        else if (e.t === "done") {
          if (e.title) qc.invalidateQueries({ queryKey: ["ai-chats"] });
          if (e.scrubbed?.length) setNote(`가린 것: ${e.scrubbed.join(" · ")}`);
        }
      }, ac.signal);
    } catch { /* 중단은 오류가 아니다 */ }
    // 서버 것을 **먼저** 받고 나서 흘러오던 것을 내린다. 반대로 하면 그 틈에 답이 잠깐 사라진다
    await qc.invalidateQueries({ queryKey: ["ai-msgs", cid] });
    if (gone()) return;                            // 옮긴 판의 상태는 이미 비웠다
    abort.current = null;
    setLive(null);
  }

  if (id != null && q.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const msgs = q.data ?? [];
  // 답할 되물음. 흘러오는 것이 먼저고, 없으면 **마지막 답**에 든 것이다.
  // 그 뒤에 내 말이 있으면 이미 답한 것이라 안 띄운다.
  const lastMsg = msgs[msgs.length - 1];
  const pendingAsk: AskItem[] | null = live
    ? (live.ask ?? null)
    : (lastMsg?.role === "assistant"
        ? ((lastMsg.content.find((p) => p.t === "ask") as { 물음?: AskItem[] } | undefined)?.물음 ?? null)
        : null);
  const empty = msgs.length === 0 && live == null && !err;
  return (
    <div className={`as-pane${pins.length && mapOn ? " with-map" : ""}`}>
    <div className="as-chat">
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
              <Pieces pieces={m.content} pins={m.pins ?? []} onFocus={onFocus} />
            </div>
          ))}
        {live && (
          <div className="as-a">
            <Tools log={live.log} running={live.running} />
            <Pieces pieces={live.pieces} live pins={live.pins} onFocus={onFocus} />
          </div>
        )}
        {note && <div className="as-note">{note}</div>}
        {err && (
          <div className="as-err"><b>{err.title}</b>{err.body && <span>{err.body}</span>}</div>
        )}
        <div ref={foot} />
      </div>

      {pendingAsk?.length ? <AskBox items={pendingAsk} onSend={go} /> : null}

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
    </div>
    {pins.length > 0 && mapOn && (
      // 답이 돌려준 건물들을 한눈에 — 검색 화면의 지도 그대로다(2026-09-21 대표). 작은 검색 창.
      <aside className="as-map">
        <MapPanel pins={mapPins} centerReq={focusReq ?? centerReq} polygonActive={false}
          selectedPk={focus?.pin.pk ?? null} selectedCol={focus?.pin.col ?? null}
          fitPadding={{ top: 40, right: 40, bottom: 60, left: 40 }}
          onPick={openPin} onPolygon={() => undefined} />
        <button className="as-mx" title="지도 닫기" onClick={() => setMapOn(false)}><Icon name="close" size={16} /></button>
      </aside>
    )}
    </div>
  );
}
