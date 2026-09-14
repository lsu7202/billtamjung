import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { CityCanvas } from "./CityCanvas";
import "../auth/login.css";
import "./landing.css";
import "./onboarding.css";

/** /welcome — 가입 직후 온보딩. 한 화면에 한 질문(칩/텍스트), 단계마다 즉시 저장(이탈해도 수집분 보존).
 * 중개인만 경력 질문 분기. 이름·성별·생년월일은 가입 폼에서 수집. */

type Step = {
  key: string;
  q: string;
  optional?: boolean;
  chips?: readonly (readonly [string, string])[];
  input?: string;                       // placeholder(텍스트형)
  when?: (a: Record<string, string>) => boolean;
};

const STEPS: Step[] = [
  { key: "job_role", q: "어떤 목적으로 오셨어요?", chips: [["broker", "중개인"], ["investor", "투자자"], ["etc", "그 외"]] },
  { key: "career_years", q: "중개 경력이 얼마나 되세요?", optional: true, chips: [["lt1", "1년 미만"], ["y1_3", "1~3년"], ["y3_10", "3~10년"], ["gt10", "10년 이상"]],
    when: (a) => a.job_role === "broker" },
  { key: "prior_tools", q: "부동산 프로그램을 써본 적 있나요?", optional: true, chips: [["yes", "있어요"], ["no", "없어요"]] },
  { key: "expect_feature", q: "빌탐정에서 가장 기대하는 건 뭐예요?", chips: [["search", "건물 검색"], ["valuation", "추정가·가치분석"], ["report", "빌탐정 리포트"], ["manage", "매물 관리"]] },
  { key: "interest_region", q: "주로 보는 지역이 어디세요?", optional: true, input: "예: 강남구, 서초구" },
  { key: "referral_source", q: "빌탐정은 어떻게 알게 되셨어요?", optional: true, chips: [["referral", "지인 추천"], ["search", "검색"], ["sns", "SNS"], ["ad", "광고"], ["etc", "기타"]] },
];

export function OnboardingPage() {
  const nav = useNavigate();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [idx, setIdx] = useState(0);
  const [text, setText] = useState("");
  const [done, setDone] = useState(false);

  const steps = useMemo(() => STEPS.filter((s) => !s.when || s.when(answers)), [answers]);
  const step = steps[idx];
  const progress = done ? 1 : idx / Math.max(1, steps.length);

  async function answer(value: string | null) {
    if (!step) return;
    const a = { ...answers };
    if (value) { a[step.key] = value; setAnswers(a); authApi.patchProfile({ [step.key]: value }).catch(() => {}); }
    setText("");
    // 다음 스텝(분기 재계산 후) — 마지막이면 완료
    const next = STEPS.filter((s) => !s.when || s.when(a));
    const cur = next.findIndex((s) => s.key === step.key);
    if (cur + 1 >= next.length) { setDone(true); setTimeout(() => nav("/search", { replace: true }), 1400); }
    else setIdx(cur + 1);
  }

  if (done) {
    return (
      <World progress={1}>
        <div className="ob-done">
          <svg width={72} height={72} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="var(--gold)" /><path d="M7.2 12.4 10.6 15.8 17 8.6" fill="none" stroke="var(--ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <div className="ob-q">준비 끝!</div>
          <p className="ob-hint">체험 크레딧 60이 지급됐어요 — 바로 시작합니다</p>
        </div>
      </World>
    );
  }
  if (!step) return null;

  return (
    <World progress={progress}>
      <div className="ob-step" key={step.key}>
        <div className="ob-count">{idx + 1} / {steps.length}</div>
        <div className="ob-q">{step.q}</div>

        {step.chips && (
          <div className="ob-chips">
            {step.chips.map(([code, label]) => (
              <button key={code} className="ob-chip" onClick={() => answer(code)}>{label}</button>
            ))}
          </div>
        )}
        {step.input && (
          <form className="ob-inputrow" onSubmit={(e) => { e.preventDefault(); if (text.trim()) answer(text.trim()); }}>
            <input className="ob-input" placeholder={step.input} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button className="ob-go" disabled={!text.trim()}>다음</button>
          </form>
        )}

        {step.optional && (
          <button className="ob-skip" onClick={() => answer(null)}>건너뛰기</button>
        )}
      </div>
    </World>
  );
}

function World({ children, progress }: { children: React.ReactNode; progress: number }) {
  return (
    <div className="s00">
      <div className="s00-dawn" />
      <CityCanvas />
      <div className="s00-scan" />
      <div className="ob-progress"><span style={{ transform: `scaleX(${progress})` }} /></div>
      <div className="s00-stage" style={{ paddingBottom: "26vh" }}>{children}</div>
    </div>
  );
}
