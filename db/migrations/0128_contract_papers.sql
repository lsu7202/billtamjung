-- 문서 3종(계약서·확인설명서·영수증)이 서는 데 필요한 칸(2026-08-23 확정, 초안 검증 후).
--
-- 돈 —
--   가계약     proposals.pre_contract_on/amount (기존)
--   계약금     proposals.down_payment (이번에)
--   중도금     schedules(kind='중도금').amount — 일정 개편 때 연결
--   잔금       저장하지 않는다. 거래금액 − 가계약 − 계약금 − 중도금의 파생값.
--   부가세     proposals.vat_mode — 금액이 아니라 조건. 미지정은 null.
--
-- 인적사항 — 저장 구분(2026-08-23): 주소·법인 대표자·법인등록번호·내외국인은 일반 개인정보로 저장.
-- **주민등록번호·외국인등록번호 칸은 만들지 않는다** — 법 24조의2(동의로도 수집 불가·법령 근거 필요),
-- 문서 화면의 프론트 상태로만 살다 인쇄되고 사라진다. 서버는 body에 섞여 와도 마스킹한다.
BEGIN;

ALTER TABLE app.proposals
  ADD COLUMN IF NOT EXISTS vat_mode text CHECK (vat_mode IN ('별도','포함')),
  ADD COLUMN IF NOT EXISTS down_payment bigint;
COMMENT ON COLUMN app.proposals.vat_mode IS '건물분 부가세 조건 — 별도·포함. null=아직 합의 전(0128)';
COMMENT ON COLUMN app.proposals.down_payment IS '계약금(원). 잔금은 저장 안 함 — 파생값(0128)';

ALTER TABLE app.owners
  ADD COLUMN IF NOT EXISTS addr text,
  ADD COLUMN IF NOT EXISTS rep_name text,
  ADD COLUMN IF NOT EXISTS corp_no text,
  ADD COLUMN IF NOT EXISTS nationality text CHECK (nationality IN ('내국인','외국인'));
ALTER TABLE app.buyers
  ADD COLUMN IF NOT EXISTS addr text,
  ADD COLUMN IF NOT EXISTS rep_name text,
  ADD COLUMN IF NOT EXISTS corp_no text,
  ADD COLUMN IF NOT EXISTS nationality text CHECK (nationality IN ('내국인','외국인'));
COMMENT ON COLUMN app.owners.corp_no IS '법인등록번호(법인 정보 — 고유식별정보 아님). 주민등록번호는 어디에도 저장하지 않는다(0128)';
COMMENT ON COLUMN app.owners.rep_name IS '법인일 때 대표자 성명 — 계약서 당사자 란(0128)';
COMMENT ON COLUMN app.buyers.corp_no IS '법인등록번호(법인 정보 — 고유식별정보 아님). 주민등록번호는 어디에도 저장하지 않는다(0128)';
COMMENT ON COLUMN app.buyers.rep_name IS '법인일 때 대표자 성명 — 계약서 당사자 란(0128)';

ALTER TABLE app.teams
  ADD COLUMN IF NOT EXISTS reg_no text,
  ADD COLUMN IF NOT EXISTS fee_rate numeric(4,2);
COMMENT ON COLUMN app.teams.reg_no IS '중개사무소 개설등록번호 — 계약서·확인설명서 하단 란(0128)';
COMMENT ON COLUMN app.teams.fee_rate IS '중개보수 요율(%) 사무소 기본값 — 건별 금액은 proposals.commission_amount(0128)';

-- 만든 문서 — 씨앗 채움과 사람 수정이 그대로 저장돼 재열람·재인쇄된다.
-- 종류당 한 판(영수증 회차 값도 body 안에 든다). body에 주민번호가 섞여 오면 서버가 마스킹한다.
CREATE TABLE IF NOT EXISTS app.contract_docs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  proposal_id bigint NOT NULL REFERENCES app.proposals(id) ON DELETE CASCADE,
  kind        text   NOT NULL CHECK (kind IN ('계약서','확인설명서','영수증')),
  body        jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_by  bigint REFERENCES app.accounts(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  UNIQUE (team_id, proposal_id, kind)
);
COMMENT ON TABLE app.contract_docs IS
  '계약 문서 — body에 서식 칸 전체(씨앗+수정). 특약은 문구 묶음에서 골라 body에 담긴다. 주민등록번호는 body에 없다 — 프론트가 안 보내고 서버가 마스킹한다(0128)';

INSERT INTO app.schema_migrations(version) VALUES ('0128_contract_papers.sql')
ON CONFLICT DO NOTHING;
COMMIT;
