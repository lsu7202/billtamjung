-- 0172 · 상호로 업체 찾기 색인 (2026-09-09)
--
-- 왜: 「피부과 많은 건물」이 0건이었다. 인허가 업종(biz1)은 「의원·치과의원·한의원·병원」까지만이고
--     **진료과는 상호에 산다** — 「멜로우피부과의원」의 업종은 그냥 「의원」이다(대표 지적).
--     상호로 세면 피부과 749곳 · 정형외과 935곳 · 안과 677곳이다. 브랜드(스타벅스·올리브영)도 같다.
DO $$ BEGIN
  IF to_regclass('master.localdata_permit') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS localdata_permit_open_name_idx
        ON master.localdata_permit (name) WHERE close_on IS NULL;
  ELSE
    RAISE NOTICE 'master.localdata_permit 없음 — 색인 건너뜀';
  END IF;
END $$;
