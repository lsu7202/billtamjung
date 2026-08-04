/** 이용약관·개인정보 수집이용 동의 — 초안(베타). 정식 출시 전 법률 검토 권장. */

export const TERMS_TEXT = `빌탐정 이용약관 (시행 2026.8.4)

제1조 (목적)
본 약관은 빌탐정(이하 "서비스")이 제공하는 상업용 부동산 데이터 조회·가치분석·매물관리 서비스의 이용 조건과 절차, 이용자와 서비스의 권리·의무를 규정합니다.

제2조 (서비스의 성격과 책임 한계)
1. 서비스가 제공하는 매매가·임대료·수익률·가치점수 등 분석값은 공공데이터를 기반으로 한 추정치이며, 감정평가 또는 투자 권유가 아닙니다.
2. 분석값은 법적 효력이 없는 참고용 정보이며, 이를 근거로 한 거래·투자 판단의 책임은 이용자에게 있습니다.
3. 공공데이터 원천의 오류·갱신 지연으로 실제와 다를 수 있습니다.

제3조 (계정)
1. 가입 시 정확한 정보를 제공해야 하며, 계정은 본인(또는 소속 팀)만 사용할 수 있습니다.
2. 체험판·크레딧 등 혜택의 부정 취득(다중 가입 등)이 확인되면 이용이 제한될 수 있습니다.

제4조 (데이터의 이용)
1. 서비스 내 데이터의 조직적 수집(크롤링·대량 추출)과 재판매를 금지합니다.
2. 이용자가 입력한 매물·업무 데이터는 해당 팀 내에서만 공유되며, 위키 등 공개 기여 데이터는 서비스 품질 향상에 활용될 수 있습니다.

제5조 (요금)
베타 기간의 혜택·요금은 사전 고지 후 변경될 수 있으며, 유료 전환 시 결제 전 고지합니다.

제6조 (해지)
이용자는 언제든 탈퇴할 수 있으며, 탈퇴 시 개인정보는 개인정보 처리방침에 따라 처리됩니다.`;

export const PRIVACY_TEXT = `개인정보 수집·이용 동의 (시행 2026.8.4)

1. 수집 항목
· 필수: 이메일, 비밀번호(암호화 저장), 이름
· 선택: 성별, 직군, 중개사무소(유무·명칭), 중개 경력, 타 프로그램 사용 경험, 관심 지역, 가입 경로, 전화번호
· 소셜 로그인 시: 제공자 식별자, 이메일, 닉네임

2. 수집·이용 목적
· 회원 식별, 서비스 제공(검색·분석·매물관리), 고객 지원
· 서비스 개선을 위한 이용 통계 분석(직군·지역별 이용 패턴 등)

3. 보유·이용 기간
· 회원 탈퇴 시까지(탈퇴 후 지체 없이 파기, 관계 법령상 보존 의무가 있는 경우 해당 기간 보존)

4. 동의 거부 권리
· 필수 항목 동의를 거부할 수 있으나, 이 경우 가입이 제한됩니다.
· 선택 항목은 동의하지 않아도 가입할 수 있습니다.

[선택] 마케팅 정보 수신 동의
· 신규 기능·혜택 안내를 이메일로 받아봅니다. 언제든 수신 거부할 수 있습니다.`;

export function TermsModal({ doc, onClose }: { doc: "terms" | "privacy"; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,17,14,.45)", zIndex: 100, display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="panel"
        style={{ width: "min(560px,100%)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className="sec-head">{doc === "terms" ? "이용약관" : "개인정보 수집·이용"}</div>
        <pre style={{ margin: 0, padding: "14px 18px", overflow: "auto", whiteSpace: "pre-wrap", font: "13px/1.7 inherit", fontFamily: "inherit", color: "var(--ink-2)" }}>
          {doc === "terms" ? TERMS_TEXT : PRIVACY_TEXT}
        </pre>
        <div style={{ padding: 12, borderTop: "1px solid var(--line)", textAlign: "right" }}>
          <button className="btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
