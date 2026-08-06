import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./beta.css";

/* 베타 주간 설문 — 주차별 짧은 설문(2~3분). /survey?w=1 로 주차 지정, 없으면 선택 화면.
   문항 정본은 manual/survey.html(PDF)과 동일. 익명 제출(POST /survey). */

type Q =
  | { k: string; t: string; hint?: string; type: "radio" | "check"; opts: string[]; etc?: boolean }
  | { k: string; t: string; hint?: string; type: "text"; rows?: number }
  | { k: string; t: string; hint?: string; type: "scale"; max: 5 | 10 };

type Week = { w: number; title: string; aim: string; mins: string; qs: Q[]; next?: string };

const WEEKS: Week[] = [
  {
    w: 1, title: "첫인상과 검색", mins: "2분",
    aim: "처음 써보신 느낌과 검색·필터에서 막힌 지점을 알려주세요.",
    next: "다음 주에는 건물 정보와 적정가·수익률이 실제와 맞는지 여쭙겠습니다.",
    qs: [
      { k: "job", t: "어떤 일을 하시나요", type: "radio",
        opts: ["공인중개사", "중개보조원", "투자자·자산관리", "개발·시행"], etc: true },
      { k: "onboard", t: "처음 열었을 때 무엇을 해야 할지 알 수 있었나요", type: "radio",
        opts: ["바로 알았다", "조금 헤맸다", "많이 헤맸다"] },
      { k: "found", t: "원하는 건물을 찾는 데 성공했나요", type: "radio",
        opts: ["쉽게 찾았다", "시간이 걸렸다", "못 찾았다"] },
      { k: "stuck", t: "검색·필터에서 막히거나 헷갈린 부분", hint: "어느 화면에서 무엇을 하려다 막혔는지", type: "text", rows: 3 },
      { k: "bug", t: "이번 주 오류·버그가 있었다면", type: "text", rows: 2 },
    ],
  },
  {
    w: 2, title: "데이터와 숫자", mins: "2분",
    aim: "건물 정보와 적정가·수익률이 실제 감각과 맞는지가 이번 주 관심사입니다.",
    next: "다음 주에는 리포트를 실제 업무에 쓰셨는지 여쭙겠습니다.",
    qs: [
      { k: "data_ok", t: "건물 정보(면적·용도·연식 등)는 실제와 맞던가요", type: "radio",
        opts: ["대체로 맞다", "가끔 다르다", "자주 다르다"] },
      { k: "price_ok", t: "빌탐정 적정가는 납득할 만했나요", hint: "1 전혀 · 5 매우", type: "scale", max: 5 },
      { k: "price_gap", t: "가장 차이가 컸던 건물과 값", hint: "주소 · 어떤 값이 · 실제로는 얼마", type: "text", rows: 3 },
      { k: "roi", t: "수익률·임대 추정은 어떠셨나요", type: "radio",
        opts: ["비슷하다", "높게 나온다", "낮게 나온다", "안 봤다"] },
      { k: "edit", t: "정보 수정·층별 임대 입력을 써보셨나요? 불편한 점은", type: "text", rows: 2 },
    ],
  },
  {
    w: 3, title: "리포트와 실무", mins: "2분",
    aim: "만든 리포트를 실제로 쓸 수 있는지가 이번 주 관심사입니다.",
    next: "다음 주에는 전체 평가와 앞으로의 방향을 여쭙겠습니다.",
    qs: [
      { k: "made", t: "리포트를 만들어 보셨나요", type: "radio",
        opts: ["만들었다", "만들다 말았다", "안 만들었다"] },
      { k: "client_ready", t: "고객에게 그대로 보여줄 수 있는 수준인가요", hint: "1 전혀 · 5 매우", type: "scale", max: 5 },
      { k: "report_wish", t: "리포트에서 빼고 싶은 것 / 넣고 싶은 것", type: "text", rows: 3 },
      { k: "helped", t: "실제 업무에 도움이 된 순간이 있었다면", hint: "예: 고객 미팅, 매물 발굴, 가격 설득", type: "text", rows: 2 },
      { k: "review", t: "사례 검토(체크 해제·정보 수정)는 쓸 만했나요", type: "radio",
        opts: ["유용했다", "어려웠다", "몰랐다"] },
    ],
  },
  {
    w: 4, title: "전체 평가", mins: "3분",
    aim: "한 달을 써보신 소감과 앞으로 무엇을 먼저 만들어야 할지 알려주세요.",
    qs: [
      { k: "nps", t: "동료에게 추천하시겠습니까", hint: "0 전혀 · 10 매우", type: "scale", max: 10 },
      { k: "best_worst", t: "가장 쓸모 있었던 기능 / 가장 아쉬웠던 기능", type: "text", rows: 2 },
      { k: "priority", t: "먼저 만들었으면 하는 것", hint: "최대 3개", type: "check",
        opts: ["모바일 앱", "서울 외 지역", "주거용 분석", "엑셀 내보내기", "고객 공유 링크",
               "리포트 편집", "조건 알림", "등기부·소유자", "대출·세금 계산"], etc: true },
      { k: "pay", t: "유료로 쓰실 의향이 있나요", type: "radio",
        opts: ["지금도 쓰겠다", "개선되면 쓰겠다", "모르겠다", "안 쓰겠다"] },
      { k: "price_point", t: "적정 가격은 얼마라고 생각하시나요", hint: "리포트 1건 또는 월 구독 기준", type: "text", rows: 1 },
      { k: "free", t: "자유롭게 남겨주세요", type: "text", rows: 4 },
      { k: "interview", t: "추가 인터뷰(20분)에 응해주실 수 있나요", type: "radio", opts: ["가능", "어려움"] },
    ],
  },
];

export function SurveyPage() {
  const [sp, setSp] = useSearchParams();
  const wParam = Number(sp.get("w"));
  const week = WEEKS.find((x) => x.w === wParam) ?? null;

  const [a, setA] = useState<Record<string, any>>({});
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: string, v: any) => setA((o) => ({ ...o, [k]: v }));
  const toggle = (k: string, v: string) => setA((o) => {
    const cur: string[] = o[k] ?? [];
    return { ...o, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] };
  });

  async function submit() {
    if (!week) return;
    const filled = Object.values(a).filter((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())).length;
    if (filled < 2) { setErr("몇 개 문항만이라도 답변해 주세요."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/survey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survey_key: `beta-w${week.w}`, answers: a, contact: contact.trim() || null }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setErr("전송에 실패했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  /* 주차 선택 화면 */
  if (!week) return (
    <div className="bt-beta"><main className="bt-main bt-survey">
      <header className="bt-sv-head">
        <span className="bt-eyebrow">베타 주간 설문</span>
        <h1>이번 주 설문을 골라주세요</h1>
        <p>주차별로 묻는 내용이 다릅니다. 각 2~3분이면 됩니다.</p>
      </header>
      <div className="wk-grid">
        {WEEKS.map((x) => (
          <button key={x.w} className="wk-card" onClick={() => setSp({ w: String(x.w) })}>
            <span className="wk-n">{x.w}주차</span>
            <b>{x.title}</b>
            <span className="wk-aim">{x.aim}</span>
            <span className="wk-min">{x.mins}</span>
          </button>
        ))}
      </div>
    </main></div>
  );

  if (done) return (
    <div className="bt-beta"><main className="bt-main bt-thanks-page">
      <h1>감사합니다.</h1>
      <p>{week.next ?? "남겨주신 의견은 하나하나 읽고 반영합니다."}</p>
    </main></div>
  );

  return (
    <div className="bt-beta">
      <main className="bt-main bt-survey">
        <header className="bt-sv-head">
          <span className="bt-eyebrow">{week.w}주차 · {week.mins}</span>
          <h1>{week.title}</h1>
          <p>{week.aim}</p>
        </header>

        <section className="bt-sv-sec">
          {week.qs.map((q, i) => (
            <div className="bt-q" key={q.k}>
              <label className="qt"><span className="qn">{i + 1}</span>{q.t}
                {q.hint && <span className="hint">{q.hint}</span>}</label>

              {(q.type === "radio" || q.type === "check") && (
                <div className="opts">
                  {q.opts.map((o) => {
                    const on = q.type === "radio" ? a[q.k] === o : (a[q.k] ?? []).includes(o);
                    return (
                      <button key={o} type="button" className={"opt" + (on ? " on" : "")}
                        onClick={() => (q.type === "radio" ? set(q.k, o) : toggle(q.k, o))}>{o}</button>
                    );
                  })}
                  {q.etc && <input className="etc" placeholder="기타" value={a[q.k + "_etc"] ?? ""}
                    onChange={(e) => set(q.k + "_etc", e.target.value)} />}
                </div>
              )}

              {q.type === "scale" && (
                <div className="nps">
                  {Array.from({ length: q.max === 10 ? 11 : 5 }, (_, k) => {
                    const v = q.max === 10 ? k : k + 1;
                    return (
                      <button key={v} type="button" className={"n" + (a[q.k] === v ? " on" : "")}
                        onClick={() => set(q.k, v)}>{v}</button>
                    );
                  })}
                </div>
              )}

              {q.type === "text" && (
                <textarea rows={q.rows ?? 3} value={a[q.k] ?? ""} onChange={(e) => set(q.k, e.target.value)} />
              )}
            </div>
          ))}

          {week.w === 4 && (
            <div className="bt-q">
              <label className="qt">연락처<span className="hint">인터뷰 가능하다고 답하신 경우에만 (선택)</span></label>
              <input className="etc wide" value={contact} onChange={(e) => setContact(e.target.value)}
                placeholder="이메일 또는 휴대폰" />
            </div>
          )}
        </section>

        {err && <div className="bt-err">{err}</div>}
        <div className="bt-submit">
          <button className="bt-btn primary lg" disabled={busy} onClick={submit}>
            {busy ? "전송 중…" : "제출하기"}
          </button>
          <span className="bt-submit-note">서비스 개선에만 사용됩니다.</span>
        </div>
      </main>
    </div>
  );
}
