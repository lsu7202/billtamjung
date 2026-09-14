import { useState } from "react";
import "./beta.css";

/** 1차 베타 마무리 설문 — **로그인 없이**, 폰에서 손가락으로(2026-08-20).
 *
 *  선택지에 긍정을 두지 않는다. 테스터들이 우리에게 호의적이라 「좋았다」가 기본값처럼
 *  쌓이는데, 그건 신호가 아니라 잡음이다. 대신 **부정 보기 + 「딱히 없었다」 한 칸**을 둔다 —
 *  그 한 칸을 고른 비율이 곧 긍정 신호다.
 *
 *  결과는 app.survey_responses 에 코드값 그대로 쌓인다(자유 서술만 문장).
 */
type Q =
  | { k: string; t: string; hint?: string; type: "radio" | "check"; opts: string[]; etc?: boolean }
  | { k: string; t: string; hint?: string; type: "text"; rows?: number };

type Sec = { title: string; sub?: string; qs: Q[] };

const NEED = [
  "시장에 나온 실제 매물", "매수자·고객 관리", "일정·업무 관리", "계약서·서류 관리",
  "정확한 시세", "광고·홍보", "지도·상권 정보",
];

const SECS: Sec[] = [
  {
    title: "어떤 분이신가요",
    qs: [
      { k: "style", t: "주로 하시는 중개 방식은 무엇인가요", type: "radio",
        opts: ["매수자 찾기", "매도자 찾기", "둘 다 비슷하다"] },
      { k: "visits", t: "1차 테스트 동안 빌탐정을 몇 번쯤 열어보셨나요", type: "radio",
        opts: ["한두 번", "서너 번", "여러 번", "열었다가 바로 닫았다"] },
    ],
  },
  {
    title: "어디서 막히셨나요",
    sub: "고를 것이 없으면 「딱히 없었다」를 눌러 주세요. 여러 개 고르실 수 있습니다.",
    qs: [
      { k: "start", t: "처음 열었을 때 막막했던 이유는 무엇인가요", type: "check",
        opts: ["어디서 시작할지 몰랐다", "용어가 낯설었다", "화면이 복잡했다",
               "기능이 어디 있는지 못 찾았다", "딱히 없었다"] },
      { k: "search", t: "건물 검색이 어려웠던 이유는 무엇인가요", type: "check", etc: true,
        opts: ["화면이 복잡하다", "원하는 조건으로 못 찾겠다", "결과를 어떻게 읽는지 모르겠다",
               "이 기능이 뭘 하는지 모르겠다", "나한테 필요 없다", "딱히 없었다"] },
      { k: "value", t: "검색 결과를 보고도 「그래서 뭐가 좋은 거지」 싶으셨다면 왜인가요", type: "check",
        opts: ["다른 데서도 볼 수 있는 정보다", "숫자를 못 믿겠다", "내 일과 연결이 안 된다",
               "설명이 없다", "딱히 없었다"] },
      { k: "report", t: "분석 보고서까지 안 가신 이유는 무엇인가요", type: "check",
        opts: ["그런 게 있는 줄 몰랐다", "만들 이유를 못 느꼈다", "만드는 법을 몰랐다",
               "도중에 막혔다", "오래 걸렸다", "결과가 기대와 달랐다", "만들어 봤다"] },
      { k: "gap", t: "기대와 다르게 동작한 기능이 있었다면 적어 주세요", type: "text", rows: 3 },
    ],
  },
  {
    title: "나한테 맞는 도구인가요",
    qs: [
      { k: "keep", t: "지금 상태 그대로라면 앞으로 어떻게 하실 것 같나요", type: "radio",
        opts: ["안 쓸 것 같다", "가끔 열어볼 것 같다", "일부 기능만 쓸 것 같다"] },
      { k: "missing", t: "이게 없어서 못 쓰겠다 싶은 것은 무엇인가요", type: "check", etc: true,
        opts: NEED },
      { k: "tools", t: "지금 쓰시는 도구는 무엇인가요", type: "check", etc: true,
        opts: ["매물관리프로그램", "디스코", "밸류맵", "네이버", "사내 프로그램", "엑셀·수기", "없다"] },
      { k: "switch", t: "그 도구 대신 빌탐정을 쓰기 어려운 이유는 무엇인가요", type: "check",
        opts: ["정보가 부족하다", "못 믿겠다", "손에 안 익는다", "이미 쓰던 게 편하다", "없다"] },
      { k: "nps_no", t: "지인에게 추천하기 어려운 이유는 무엇인가요", type: "check",
        opts: ["아직 완성도가 부족하다", "내 업무와 안 맞는다", "정보를 못 믿겠다",
               "값을 모르겠다", "없다"] },
      { k: "price", t: "월 구독료가 얼마부터 비싸다고 느끼실 것 같나요", type: "radio",
        opts: ["무료가 아니면 안 쓴다", "1만원", "3만원", "5만원", "10만원", "그 이상도 낼 만하다"] },
      { k: "pay_for", t: "어떤 기능이 들어오면 돈을 낼 만하다고 보시나요", type: "check", etc: true,
        opts: NEED },
    ],
  },
  {
    title: "마무리",
    qs: [
      { k: "beta2", t: "2차 베타테스트에 참여하실 의사가 있으신가요", type: "radio",
        opts: ["참여하겠다", "일정 보고 정하겠다", "참여 어렵다"] },
      // 「원하는 기능」만 물으면 우리 화면 안에서만 답한다(2026-08-21). 힘든 일을 먼저 물어야
      // 우리가 아직 안 만든 것이 나온다 — 답의 재료는 기능이 아니라 그 사람의 하루다.
      { k: "wish", t: "중개 일을 하면서 가장 힘들고 귀찮다고 느끼는 것은 무엇인가요? 어떤 기능이 생기면 가장 도움이 될 것 같나요?",
        type: "text", rows: 6 },
    ],
  },
];


export function Beta1Survey() {
  const [a, setA] = useState<Record<string, never>>({} as Record<string, never>);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const val = a as unknown as Record<string, string | string[] | undefined>;
  const set = (k: string, v: string) => setA((o) => ({ ...o, [k]: v } as never));
  const toggle = (k: string, v: string) => setA((o) => {
    const cur = ((o as unknown as Record<string, string[]>)[k] ?? []);
    return { ...o, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as never;
  });

  async function submit() {
    const filled = Object.values(val).filter((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())).length;
    if (filled < 3) { setErr("몇 개 문항만이라도 답변해 주세요."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/survey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survey_key: "beta1-close", answers: val }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setErr("전송에 실패했습니다. 잠시 후 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="bt-beta"><main className="bt-main bt-thanks-page">
      <h1>감사합니다.</h1>
      <p>남겨주신 의견은 하나하나 읽고 2차 테스트에 반영하겠습니다.</p>
    </main></div>
  );

  let n = 0;
  return (
    <div className="bt-beta">
      <main className="bt-main bt-survey sv1">
        <header className="bt-sv-head">
          <span className="bt-eyebrow">빌탐정 베타테스트</span>
          <h1>1차 테스트를 마치며</h1>
          <p>
            베타테스트에 참여해 주셔서 감사합니다. 덕분에 1차 테스트를 잘 마쳤습니다.
            2차를 준비하며 짧은 설문을 드립니다. 3분이면 됩니다.
          </p>
        </header>

        {SECS.map((sec) => (
          <section className="bt-sv-sec sv1-sec" key={sec.title}>
            <h2 className="sv1-h">{sec.title}</h2>
            {sec.sub && <p className="sv1-sub">{sec.sub}</p>}
            {sec.qs.map((q) => {
              n += 1;
              return (
                <div className="bt-q" key={q.k}>
                  <label className="qt"><span className="qn">{n}</span>{q.t}
                    {q.hint && <span className="hint">{q.hint}</span>}</label>

                  {(q.type === "radio" || q.type === "check") && (
                    <div className="opts">
                      {q.opts.map((o) => {
                        const on = q.type === "radio"
                          ? val[q.k] === o
                          : ((val[q.k] as string[]) ?? []).includes(o);
                        return (
                          <button key={o} type="button" className={"opt" + (on ? " on" : "")}
                            onClick={() => (q.type === "radio" ? set(q.k, o) : toggle(q.k, o))}>{o}</button>
                        );
                      })}
                      {q.etc && (
                        <input className="etc" placeholder="기타 — 직접 적어 주세요"
                          value={(val[q.k + "_etc"] as string) ?? ""}
                          onChange={(e) => set(q.k + "_etc", e.target.value)} />
                      )}
                    </div>
                  )}

                  {q.type === "text" && (
                    <textarea rows={q.rows ?? 3} value={(val[q.k] as string) ?? ""}
                      onChange={(e) => set(q.k, e.target.value)} />
                  )}
                </div>
              );
            })}
          </section>
        ))}

        {err && <div className="bt-err">{err}</div>}
        <div className="bt-submit">
          <button className="bt-btn primary sv1-go" disabled={busy} onClick={submit}>
            {busy ? "전송 중…" : "제출하기"}
          </button>
          <span className="bt-submit-note">서비스 개선에만 사용됩니다. 로그인 없이 익명으로 제출됩니다.</span>
        </div>
      </main>
    </div>
  );
}
