import { useState } from "react";
import { Link } from "react-router-dom";
import "./beta.css";

/* 베타 설문 — 로그인 없이 제출 가능(POST /survey). 문항 정본은 manual/survey.html(PDF)과 동일. */

type Q =
  | { k: string; t: string; hint?: string; type: "radio" | "check"; opts: string[]; etc?: boolean }
  | { k: string; t: string; hint?: string; type: "text"; rows?: number }
  | { k: string; t: string; hint?: string; type: "nps" }
  | { k: string; t: string; hint?: string; type: "matrix"; rows: string[] };

const SECTIONS: { s: string; note?: string; qs: Q[] }[] = [
  { s: "응답자 정보", qs: [
    { k: "job", t: "현재 하시는 일", type: "radio", opts: ["공인중개사", "중개보조원", "투자자·자산관리", "개발·시행"], etc: true },
    { k: "career", t: "상업용 부동산 경력", type: "radio", opts: ["1년 미만", "1~3년", "3~7년", "7~15년", "15년 이상"] },
    { k: "usage", t: "이번 베타에서 얼마나 쓰셨나요", type: "radio", opts: ["한 번 둘러봄", "2~3회", "여러 번(주 1회 이상)", "실제 업무에 사용"] },
    { k: "used", t: "사용해본 기능", hint: "해당되는 것 모두", type: "check",
      opts: ["주소 검색", "조건 필터로 발굴", "지도에 영역 그리기", "매물 상세 조회", "주변 상권 정의", "정보 수정", "층별 임대 입력", "사진 업로드", "리포트 생성", "PPT 다운로드"] },
  ]},
  { s: "전반 평가", qs: [
    { k: "nps", t: "빌탐정을 동료에게 추천하시겠습니까", hint: "0 전혀 아니다 — 10 매우 그렇다", type: "nps" },
    { k: "nps_why", t: "그렇게 답하신 이유는?", type: "text", rows: 2 },
    { k: "sat", t: "항목별 만족도", hint: "1 매우 불만 — 5 매우 만족", type: "matrix",
      rows: ["건물을 찾는 과정(검색·필터)", "건물 정보의 양과 정확도", "적정가의 납득 가능성", "리포트의 완성도", "화면 구성과 사용 편의성", "속도(로딩·반응)"] },
  ]},
  { s: "불편했던 점", note: "가장 중요한 부분입니다", qs: [
    { k: "stuck", t: "사용 중 막히거나 헷갈렸던 순간이 있었다면 언제였나요?", hint: "어느 화면에서 무엇을 하려다 어떻게 막혔는지", type: "text", rows: 4 },
    { k: "wrong_kind", t: "기대와 달랐던 숫자가 있었나요?", type: "check",
      opts: ["적정가가 시세와 차이 남", "수익률이 이상함", "건물 정보가 실제와 다름", "특별히 없음"] },
    { k: "wrong_detail", t: "어떤 건물의 어떤 값이 어떻게 달랐는지 적어주세요", type: "text", rows: 3 },
    { k: "bug", t: "오류나 버그를 만나셨나요?", hint: "화면 멈춤·값이 안 바뀜·에러 메시지 등", type: "text", rows: 3 },
    { k: "confusing", t: "설명 없이는 알기 어려웠던 기능이 있나요?", type: "text", rows: 2 },
  ]},
  { s: "있었으면 하는 것", qs: [
    { k: "want_free", t: "지금 없어서 아쉬운 기능은 무엇인가요?", type: "text", rows: 4 },
    { k: "want_pick", t: "먼저 만들었으면 하는 것", hint: "최대 3개", type: "check",
      opts: ["모바일 앱 / 휴대폰 최적화", "서울 외 지역 확대", "주거용 건물 분석", "매물 목록 엑셀 내보내기", "고객에게 보낼 링크 공유", "리포트 디자인·문구 편집", "조건 맞는 건물 알림", "등기부·소유자 정보", "대출·세금 시뮬레이션"], etc: true },
  ]},
  { s: "실제 업무에서", qs: [
    { k: "helped", t: "빌탐정이 실제 업무에 도움이 됐다면, 어떤 상황이었나요?", hint: "예: 고객 미팅 자료, 매물 발굴, 가격 설득", type: "text", rows: 3 },
    { k: "others", t: "지금 쓰고 계신 다른 도구가 있나요? 빌탐정과 비교하면 어떤가요?", type: "text", rows: 3 },
    { k: "pay", t: "정식 출시 후 유료로 쓰실 의향이 있나요?", type: "radio",
      opts: ["지금 형태로도 쓰겠다", "몇 가지 개선되면 쓰겠다", "아직 모르겠다", "쓰지 않겠다"] },
    { k: "pay_why", t: "'개선되면'을 고르셨다면, 무엇이 개선되어야 할까요?", type: "text", rows: 2 },
    { k: "price", t: "적정한 가격은 얼마라고 생각하시나요?", hint: "리포트 1건 기준 또는 월 구독 기준", type: "text", rows: 1 },
  ]},
  { s: "마지막으로", qs: [
    { k: "free", t: "빌탐정에 하고 싶은 말을 자유롭게 남겨주세요", hint: "칭찬도, 쓴소리도 모두 환영합니다", type: "text", rows: 5 },
    { k: "interview", t: "추가 인터뷰(20분 내외)에 응해주실 수 있나요?", type: "radio", opts: ["가능합니다", "어렵습니다"] },
  ]},
];

export function SurveyPage() {
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
    const filled = Object.values(a).filter((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())).length;
    if (filled < 3) { setErr("몇 개 문항만이라도 답변해 주세요."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/survey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: a, contact: contact.trim() || null }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErr("전송에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally { setBusy(false); }
  }

  if (done) return (
    <div className="bt-beta"><main className="bt-main bt-thanks-page">
      <h1>감사합니다.</h1>
      <p>남겨주신 의견은 하나하나 읽고 다음 버전에 반영합니다.<br />특히 불편했던 점이 가장 큰 도움이 됩니다.</p>
      <div className="bt-cta">
        <Link className="bt-btn primary" to="/search">빌탐정으로 돌아가기</Link>
        <Link className="bt-btn ghost" to="/guide">사용 안내 다시 보기</Link>
      </div>
    </main></div>
  );

  return (
    <div className="bt-beta">
      <main className="bt-main bt-survey">
        <header className="bt-sv-head">
          <span className="bt-eyebrow">베타 테스트 설문</span>
          <h1>써보신 경험을 들려주세요</h1>
          <p>5~7분이면 됩니다. 좋았던 점보다 <b>불편했던 점</b>이 훨씬 도움이 됩니다.
            이름 없이 응답하셔도 되고, 답하기 곤란한 문항은 건너뛰셔도 됩니다.</p>
        </header>

        {SECTIONS.map((sec) => (
          <section className="bt-sv-sec" key={sec.s}>
            <h2>{sec.s}{sec.note && <span className="note">— {sec.note}</span>}</h2>
            {sec.qs.map((q) => (
              <div className="bt-q" key={q.k}>
                <label className="qt">{q.t}{q.hint && <span className="hint">{q.hint}</span>}</label>

                {q.type === "radio" && (
                  <div className="opts">
                    {q.opts.map((o) => (
                      <button key={o} type="button" className={"opt" + (a[q.k] === o ? " on" : "")}
                        onClick={() => set(q.k, o)}>{o}</button>
                    ))}
                    {q.etc && <input className="etc" placeholder="기타" value={a[q.k + "_etc"] ?? ""}
                      onChange={(e) => set(q.k + "_etc", e.target.value)} />}
                  </div>
                )}

                {q.type === "check" && (
                  <div className="opts">
                    {q.opts.map((o) => (
                      <button key={o} type="button" className={"opt" + ((a[q.k] ?? []).includes(o) ? " on" : "")}
                        onClick={() => toggle(q.k, o)}>{o}</button>
                    ))}
                    {q.etc && <input className="etc" placeholder="기타" value={a[q.k + "_etc"] ?? ""}
                      onChange={(e) => set(q.k + "_etc", e.target.value)} />}
                  </div>
                )}

                {q.type === "nps" && (
                  <div className="nps">
                    {Array.from({ length: 11 }, (_, i) => (
                      <button key={i} type="button" className={"n" + (a[q.k] === i ? " on" : "")}
                        onClick={() => set(q.k, i)}>{i}</button>
                    ))}
                  </div>
                )}

                {q.type === "matrix" && (
                  <div className="matrix">
                    {q.rows.map((row) => (
                      <div className="mrow" key={row}>
                        <span className="ml">{row}</span>
                        <span className="mv">
                          {[1, 2, 3, 4, 5].map((v) => (
                            <button key={v} type="button" className={"m" + ((a[q.k] ?? {})[row] === v ? " on" : "")}
                              onClick={() => set(q.k, { ...(a[q.k] ?? {}), [row]: v })}>{v}</button>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {q.type === "text" && (
                  <textarea rows={q.rows ?? 3} value={a[q.k] ?? ""} onChange={(e) => set(q.k, e.target.value)} />
                )}
              </div>
            ))}
          </section>
        ))}

        <section className="bt-sv-sec">
          <div className="bt-q">
            <label className="qt">연락처<span className="hint">인터뷰 가능하다고 답하신 경우에만 (선택)</span></label>
            <input className="etc wide" value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="이메일 또는 휴대폰" />
          </div>
        </section>

        {err && <div className="bt-err">{err}</div>}
        <div className="bt-submit">
          <button className="bt-btn primary lg" disabled={busy} onClick={submit}>
            {busy ? "전송 중…" : "설문 제출하기"}
          </button>
          <span className="bt-submit-note">제출한 내용은 서비스 개선에만 사용됩니다.</span>
        </div>
      </main>
    </div>
  );
}
