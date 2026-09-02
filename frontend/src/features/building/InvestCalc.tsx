import { useState } from "react";
import { won } from "../../shared/format";
import { KV, vNonNeg } from "./KV";

/** 투자 분석 — 자기자본·금리·부대비용률을 넣어 자기자본 수익률(ROE)을 낸다.
 *  건물 상세 본문에 있던 판인데, 이건 **사실이 아니라 내 가정**이라 정본 칸 옆에 둘 수 없었다.
 *  분석 탭 맨 아래로 옮겼다(2026-08-25) — 밑값으로 추정가를 쓰니 여기가 제자리다. */
const FEE_PCT_DEFAULT = 5.7;

export function InvestCalc({ price, yearRent }: { price: number | null; yearRent: number }) {
  const [equity, setEquity] = useState("");                 // 콤마 포함 원 문자열(KV money와 동일)
  const [rate, setRate] = useState("");
  const [feePct, setFeePct] = useState(String(FEE_PCT_DEFAULT));
  const eq = Number(equity.replace(/,/g, "")) || 0;         // 자기자본(원)
  const r = parseFloat(rate) || 0;                          // 대출금리(연 %)
  const fp = feePct === "" ? 0 : parseFloat(feePct) || 0;   // 부대비용률(%)
  const fee = price ? Math.round(price * (fp / 100)) : 0;   // 취득 부대비용(원)
  const acq = price ? price + fee : 0;                      // 총투자비 = 매매가 + 부대비용
  const loan = acq && eq ? Math.max(0, acq - eq) : 0;       // 대출액 = 총투자비 − 자기자본
  // LTV는 담보가치(매매가) 기준이 표준이다 — 총투자비로 나누면 은행이 말하는 LTV와 달라진다.
  const ltv = price && loan ? (loan / price) * 100 : null;
  const annInt = Math.round(loan * (r / 100));              // 연 이자
  const annNet = yearRent - annInt;                          // 연 순수익(임대료 − 이자)
  const roe = eq > 0 ? (annNet / eq) * 100 : null;          // 자기자본수익률(ROE)
  const row = (k: string, v: React.ReactNode, strong?: boolean) => (
    <div className="kv"><span className="k">{k}</span>
      <span className="v num" style={{ color: strong ? "var(--signal)" : undefined }}>{v}</span></div>
  );
  return (
    <div className="kv-grid">
      {/* 자기자본 = 매매가와 동일한 KV money(클릭→편집·억 단위 입력·↺). 저장 대신 로컬 상태에 반영 */}
      <KV label="자기자본" field="equity" value={eq ? won(eq) : ""} editable money
        current={equity} validate={vNonNeg}
        onSave={(_f, v) => setEquity(v)} onRevert={() => setEquity("")} />
      {/* 대출 금리 = 건폐율·용적률 등 %필드와 동일한 KV(클릭→편집·% 표시·↺) */}
      <KV label="대출 금리(연)" field="rate" value={rate !== "" ? rate : ""} unit="%" editable
        current={rate} validate={vNonNeg} onSave={(_f, v) => setRate(v)} onRevert={() => setRate("")} />
      {/* 부대비용률 — 기본 5.7%(중개 0.9 + 취득세등 4.6 + 법무사 0.2). 협의로 달라지니 고칠 수 있다. */}
      <KV label="취득 부대비용률" field="feePct" value={feePct !== "" ? feePct : ""} unit="%" editable
        current={feePct} validate={vNonNeg}
        onSave={(_f, v) => setFeePct(v)} onRevert={() => setFeePct(String(FEE_PCT_DEFAULT))} />
      {row("취득 부대비용", fee ? won(fee) : "—")}
      {row("총투자비", acq ? won(acq) : "—")}
      {row("대출액", loan ? `${won(loan)}${ltv != null ? `  ·  LTV ${ltv.toFixed(0)}%` : ""}` : (eq && price ? "0 (전액 자기자본)" : "—"))}
      {row("연 이자", annInt ? won(annInt) : "—")}
      {row("연 순수익", eq && price ? won(annNet) : "—")}
      {row("자기자본 수익률", roe != null && price ? `${roe.toFixed(1)}%` : "—", true)}
    </div>
  );
}
