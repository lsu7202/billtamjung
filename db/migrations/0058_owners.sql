-- 0058 · 매도자(소유자)를 **사람 객체**로 — app.owners + listings.owner_id
--
-- 왜: 지금까지 매도자는 테이블이 아니라 app.listings 의 컬럼이었다(owner_name·owner_phone…).
--     그래서 영업의 「매도 · 사람」 화면 한 줄은 사람이 아니라 매물이었고, 한 사람이 매물을
--     셋 갖고 있으면 서로 남남인 세 줄로 흩어졌다. 매수는 사람(app.buyers)이 객체라
--     「사람 하나 → 담긴 매물들」로 보이는데, 매도만 그 대칭이 없었다.
--
-- 관계: 매도자 1 ─ N 매물 (매물의 주인은 하나뿐이라 listings 에 단일 FK)
--       매수자 M ─ N 매물 (관계가 여럿이라 app.proposals 라는 별도 표)
--
-- 어느 값이 사람에게 가고 어느 값이 매물에 남나:
--   사람(owners) — 이름·전화·개인/법인·관계·협조도·친절도·소유자 메모
--   매물(listings) — 진행상태·긴급도·등급·입지·매수의향서·명도·용도변경·멸실·노후도·매물번호·접수일
--   협조도/친절도는 사람의 성향이지 매물의 성질이 아니다. 같은 사람의 다른 매물에서도 같다.

BEGIN;

CREATE TABLE IF NOT EXISTS app.owners (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id     bigint NOT NULL,
  name        text,
  phone       text,
  owner_type  text,          -- 개인 / 법인 (enum owner_type)
  relation    text,          -- 건물주 / 법인대표 …
  cooperation text,
  kindness    text,
  note        text,
  created_by  bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX IF NOT EXISTS owners_team_idx ON app.owners (team_id) WHERE deleted_at IS NULL;

ALTER TABLE app.listings ADD COLUMN IF NOT EXISTS owner_id bigint REFERENCES app.owners(id);
CREATE INDEX IF NOT EXISTS listings_owner_idx ON app.listings (owner_id);

-- ── 옮겨 담기 ────────────────────────────────────────────
-- 같은 사람인지는 **전화번호(숫자만)**로 본다. 없으면 이름으로. 이름 오타·동명이인은
-- 나중에 화면에서 합칠 수 있게 두고, 지금은 있는 값 그대로 옮긴다(없던 사람을 만들지 않는다).
DO $$
DECLARE has_cols boolean;
BEGIN
  SELECT count(*) = 7 INTO has_cols FROM information_schema.columns
   WHERE table_schema='app' AND table_name='listings'
     AND column_name IN ('owner_name','owner_phone','owner_type','relation',
                         'cooperation','kindness','owner_note');
  IF NOT has_cols THEN RETURN; END IF;      -- 이미 옮긴 DB

  INSERT INTO app.owners(team_id, name, phone, owner_type, relation, cooperation, kindness, note)
  SELECT team_id,
         (array_agg(owner_name  ORDER BY updated_at DESC) FILTER (WHERE owner_name  IS NOT NULL))[1],
         (array_agg(owner_phone ORDER BY updated_at DESC) FILTER (WHERE owner_phone IS NOT NULL))[1],
         (array_agg(owner_type  ORDER BY updated_at DESC) FILTER (WHERE owner_type  IS NOT NULL))[1],
         (array_agg(relation    ORDER BY updated_at DESC) FILTER (WHERE relation    IS NOT NULL))[1],
         (array_agg(cooperation ORDER BY updated_at DESC) FILTER (WHERE cooperation IS NOT NULL))[1],
         (array_agg(kindness    ORDER BY updated_at DESC) FILTER (WHERE kindness    IS NOT NULL))[1],
         (array_agg(owner_note  ORDER BY updated_at DESC) FILTER (WHERE owner_note  IS NOT NULL))[1]
    FROM app.listings
   WHERE COALESCE(owner_name, owner_phone) IS NOT NULL
   GROUP BY team_id,
            COALESCE(NULLIF(regexp_replace(COALESCE(owner_phone,''), '\D', '', 'g'), ''), owner_name);

  UPDATE app.listings l SET owner_id = o.id
    FROM app.owners o
   WHERE o.team_id = l.team_id
     AND COALESCE(NULLIF(regexp_replace(COALESCE(o.phone,''), '\D', '', 'g'), ''), o.name)
       = COALESCE(NULLIF(regexp_replace(COALESCE(l.owner_phone,''), '\D', '', 'g'), ''), l.owner_name);

  ALTER TABLE app.listings
    DROP COLUMN owner_name, DROP COLUMN owner_phone, DROP COLUMN owner_type,
    DROP COLUMN relation,   DROP COLUMN cooperation, DROP COLUMN kindness,
    DROP COLUMN owner_note;
END $$;

COMMIT;
