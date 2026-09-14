# 메타데이터 레지스트리 스키마 (`ref`) — DDL

> **역할**: 필드·enum·산식 파라미터를 **데이터로** 관리 → 추가·수정 시 고칠 곳을 1곳으로 수렴([[../07-architecture/01-상세설계]] §9).
> 정본 문서: 필드=`data-overview.md` · enum=`enums.md` · 산식=`formulas.md` → **이 테이블들이 그 기계판(machine-readable) 정본**.
> 스키마 `ref`: config·메타데이터, 저·희소 쓰기·전역 읽기. master/app과 분리. 작성 2026-07-21.

```sql
CREATE SCHEMA IF NOT EXISTS ref;

CREATE TYPE ref.data_type   AS ENUM ('num','text','enum','date','series','bool');
CREATE TYPE ref.field_layer AS ENUM ('public','private','derived');  -- 공공마스터 / 사적오버레이 / 파생
CREATE TYPE ref.target_kind AS ENUM ('building','parcel');
```

---

## 1. `ref.enum_groups` · `ref.enums` — 드롭다운 코드값

```sql
-- enum 그룹(용도지역·등급·명도…) 정의
CREATE TABLE ref.enum_groups (
  enum_key  text PRIMARY KEY,            -- 'use_zone','grade','meongdo','main_use'
  label     text NOT NULL,               -- '용도지역'
  two_tier  boolean NOT NULL DEFAULT false, -- 우선순위 2단(주용도)
  note      text
);

-- enum 값: 저장=code, 표시=label (enums.md §"저장 코드 ↔ 표시 라벨 분리")
CREATE TABLE ref.enums (
  enum_key    text NOT NULL REFERENCES ref.enum_groups(enum_key) ON DELETE CASCADE,
  code        text NOT NULL,             -- 저장 코드 'UQA220','01000','A'
  label       text NOT NULL,             -- 표시 '일반상업지역'
  sort_order  int  NOT NULL DEFAULT 0,   -- 표시 순서
  tier        text CHECK (tier IN ('primary','secondary')),  -- 2단 그룹만(주요/그외)
  parent_code text,                       -- 계층(토지이용상황 섹터↔세부) nullable
  active      boolean NOT NULL DEFAULT true,
  meta        jsonb  NOT NULL DEFAULT '{}',
  PRIMARY KEY (enum_key, code)
);
CREATE INDEX enums_group_idx ON ref.enums (enum_key, sort_order) WHERE active;
```

**시드 예** (근거: `enums.md`·`codes-vworld.md`):
```sql
INSERT INTO ref.enum_groups(enum_key,label,two_tier) VALUES
 ('use_zone','용도지역',false), ('main_use','주용도',true),
 ('land_use','토지이용상황',false), ('grade','등급',false),
 ('ipji','입지',false), ('meongdo','명도',false),
 ('use_change','용도변경',false), ('myeolsil','멸실',false),
 ('nohudo','노후도',false), ('jindo','진행상태',false),
 ('owner_type','소유자타입',false);

-- 용도지역(LMIS UQA 정본 — codes-vworld.md §6)
INSERT INTO ref.enums(enum_key,code,label,sort_order) VALUES
 ('use_zone','UQA110','전용주거지역',10), ('use_zone','UQA121','제1종일반주거지역',20),
 ('use_zone','UQA122','제2종일반주거지역',30), ('use_zone','UQA123','제3종일반주거지역',40),
 ('use_zone','UQA130','준주거지역',50), ('use_zone','UQA210','중심상업지역',60),
 ('use_zone','UQA220','일반상업지역',70), ('use_zone','UQA230','근린상업지역',80),
 ('use_zone','UQA240','유통상업지역',90), ('use_zone','UQA330','준공업지역',100),
 ('use_zone','UQA500','도시지역미지정',110);  -- (전량은 codes-vworld.md)

-- 주용도(5자리 코드 · 우선순위 2단 — enums.md §주용도)
INSERT INTO ref.enums(enum_key,code,label,sort_order,tier) VALUES
 ('main_use','02000','공동주택',10,'primary'), ('main_use','14000','업무시설',20,'primary'),
 ('main_use','03000','제1종근린생활시설',30,'primary'), ('main_use','04000','제2종근린생활시설',40,'primary'),
 ('main_use','01000','단독주택',50,'secondary'), ('main_use','33000','국방·군사시설',60,'secondary');

-- 빌탐정 자체 지표(⚠️ code 확정 필요 — enums.md 표시 라벨 정본, 코드 provisional)
INSERT INTO ref.enums(enum_key,code,label,sort_order) VALUES
 ('grade','A','매우좋음',10),('grade','B','좋음',20),('grade','C','나쁨',30),('grade','D','매우나쁨',40),('grade','U','미지정',99),
 ('meongdo','done','완료',10),('meongdo','able','가능',20),('meongdo','unable','불가',30),('meongdo','part','일부',40),('meongdo','cond','조건부',50),('meongdo','U','미지정',99);
```

---

## 2. `ref.fields` — 필드 레지스트리 (컬럼정의서 정본)

> **★ 오버레이 수정 정책 (사용자 확정 · 정정 2026-07-21)**: 마스터 데이터는 **좌표·주소·폴리곤·식별자(building_pk·pnu·geom·addr·lng·lat·sgg_code·bjd_code)를 제외하고 전부 유저 오버레이로 수정 가능**하다. `ref.fields`는 **enum 검증·라벨 메타**이지 editability 게이트가 **아니다**. 즉 레지스트리에 등록 안 된 마스터 필드도 수정된다(차단목록만 거부, `app.validate_overlay` 트리거). `editable` 컬럼은 참고용(차단목록 외 전부 true).

```sql
CREATE TABLE ref.fields (
  field_key     text PRIMARY KEY,          -- 'gongsi','land_area','far','assignee','value_score'
  label         text NOT NULL,             -- '공시지가'
  unit          text,                        -- '만원/㎡','평','%'  (nullable)
  data_type     ref.data_type   NOT NULL,
  layer         ref.field_layer NOT NULL,   -- public|private|derived
  target        ref.target_kind NOT NULL DEFAULT 'building',  -- 건물 값 vs 필지 값
  source_ref    text,                        -- 'build_gangnam.A13'(public) / null(private·derived)
  enum_key      text REFERENCES ref.enum_groups(enum_key),    -- data_type='enum'일 때
  formula_id    text,                        -- 'F-16'(layer='derived')
  editable      boolean NOT NULL DEFAULT true,   -- 참고용(차단목록 외 전부 true) · 게이트 아님
  masked        boolean NOT NULL DEFAULT false,  -- 응답 마스킹(전화 등)?
  searchable    boolean NOT NULL DEFAULT false,  -- S01b 필터 대상?
  in_report     boolean NOT NULL DEFAULT false,  -- 보고서 노출?
  display_group text,                        -- 'money','building','land','reg','detail','biz'
  display_order int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  description   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- 정합 규칙: enum이면 enum_key 필수, derived면 formula_id 필수, public이면 source_ref 필수
  CONSTRAINT fields_enum_ck    CHECK (data_type <> 'enum'   OR enum_key   IS NOT NULL),
  CONSTRAINT fields_derived_ck CHECK (layer     <> 'derived' OR formula_id IS NOT NULL),
  CONSTRAINT fields_public_ck  CHECK (layer     <> 'public'  OR source_ref IS NOT NULL)
);
CREATE INDEX fields_group_idx ON ref.fields (display_group, display_order) WHERE active;
CREATE INDEX fields_search_idx ON ref.fields (searchable) WHERE active AND searchable;
```

**시드 예**:
```sql
INSERT INTO ref.fields
 (field_key,label,unit,data_type,layer,target,source_ref,enum_key,formula_id,editable,masked,searchable,in_report,display_group,display_order) VALUES
 -- 공공(마스터) — 필지 단위 공시지가(오버레이 수정 가능·검색 가능)
 ('gongsi','공시지가','만원/㎡','series','public','parcel','gongsi_series',NULL,NULL,true,false,true,true,'land',10),
 ('use_zone','용도지역',NULL,'enum','public','parcel','parcels.uqa','use_zone',NULL,true,false,true,true,'land',20),
 ('land_area','토지면적','㎡','num','public','parcel','parcels.area',NULL,NULL,true,false,true,true,'land',30),
 ('far','용적률','%','num','public','building','buildings.far',NULL,NULL,true,false,true,true,'building',40),
 -- 사적(오버레이) — 상세정보/업무 (S02 §3.4b/§4.1)
 ('meongdo','명도',NULL,'enum','private','building',NULL,'meongdo',NULL,true,false,true,false,'detail',10),
 ('assignee','담당자',NULL,'enum','private','building',NULL,NULL,NULL,true,false,true,false,'biz',10),
 ('owner_phone','전화번호',NULL,'text','private','building',NULL,NULL,NULL,true,true,false,false,'biz',90),
 -- 파생 — 보고서 전용(가치점수)
 ('value_score','가치점수',NULL,'num','derived','building',NULL,NULL,'F-16',false,false,false,true,'report',10);
```
> `assignee`는 enum이 아니라 **팀 멤버 참조**(FK→app.accounts)라 별도 처리 — 레지스트리엔 `data_type='enum', enum_key=NULL`로 두고 서비스가 팀 멤버로 채운다(예외 1건, 주석).

---

## 3. `ref.formula_sets` · `ref.formula_params` — 산식 파라미터 (버전관리)

```sql
-- 파라미터 세트 버전(가중치 튜닝 이력 · 보고서 재현성)
CREATE TABLE ref.formula_sets (
  set_version   int PRIMARY KEY,           -- 1,2,3…
  effective_from date NOT NULL,
  active        boolean NOT NULL DEFAULT false,  -- 현재 적용본(정확히 1개)
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX formula_active_one ON ref.formula_sets(active) WHERE active; -- 활성 1개 보장

CREATE TABLE ref.formula_params (
  set_version int  NOT NULL REFERENCES ref.formula_sets(set_version) ON DELETE CASCADE,
  formula_id  text NOT NULL,               -- 'F-16','F-17'
  param_key   text NOT NULL,               -- 'weight.road_access','grade_cut.S','time_adjust.2020'
  value_num   numeric,
  value_json  jsonb,
  PRIMARY KEY (set_version, formula_id, param_key),
  CHECK (value_num IS NOT NULL OR value_json IS NOT NULL)
);
```

**시드 예** (근거: `formulas.md` F-16 가중치·등급컷):
```sql
INSERT INTO ref.formula_sets(set_version,effective_from,active,note)
 VALUES (1,'2026-07-01',true,'초기 가중치(formulas.md)');

INSERT INTO ref.formula_params(set_version,formula_id,param_key,value_num) VALUES
 -- F-16 가치점수 가중치 (합 100)
 (1,'F-16','weight.road_access',18), (1,'F-16','weight.station_dist',18),
 (1,'F-16','weight.use_zone',18),    (1,'F-16','weight.shape',15),
 (1,'F-16','weight.approval_date',13),(1,'F-16','weight.elevator',8),
 (1,'F-16','weight.remodel',8),      (1,'F-16','weight.slope',2),
 -- 등급컷
 (1,'F-16','grade_cut.S',90), (1,'F-16','grade_cut.A',75), (1,'F-16','grade_cut.B',60),
 -- F-17 유사도 가중 하한
 (1,'F-17','similarity.floor',0.3);
-- 시점보정표(F-17 ②)는 연도별 → value_json 한 방에
INSERT INTO ref.formula_params(set_version,formula_id,param_key,value_json) VALUES
 (1,'F-17','time_adjust', '{"2021":0.12,"2022":0.05,"2023":-0.02,"2024":0.03,"2025":0.04,"2026":0.0}');
```
- 보고서 생성 시 **활성 세트 버전을 읽고**, `reports.formula_set_version`에 기록 → 나중에 **동일 재현**·재계산 가능. 가중치 튜닝 = 새 set_version INSERT + active 이전 → **배포 0**.

---

## 4. app 레이어와의 연결 (정합 강제)

```sql
-- 오버레이 field에 FK를 걸지 않는다(미등록 마스터 필드도 수정 가능해야 하므로).
-- 검증 = 차단목록(식별·위치)만 거부 + enum이면 코드 검증. 나머지 자유값 허용.
CREATE OR REPLACE FUNCTION app.validate_overlay() RETURNS trigger AS $$
DECLARE f ref.fields; BEGIN
  IF NEW.field IN ('building_pk','pnu','addr','road_addr','jibun_norm',
                   'geom','lng','lat','sgg_code','bjd_code') THEN
    RAISE EXCEPTION '수정 불가 필드(식별·위치): %', NEW.field;   -- 좌표·주소·식별자만 불변
  END IF;
  SELECT * INTO f FROM ref.fields WHERE field_key = NEW.field;
  IF FOUND AND f.data_type = 'enum' AND NEW.value IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM ref.enums e WHERE e.enum_key=f.enum_key AND e.code=NEW.value AND e.active)
  THEN RAISE EXCEPTION '유효하지 않은 enum 값: %=%', NEW.field, NEW.value; END IF;
  RETURN NEW;   -- 미등록·비enum = 마스터 위 자유 오버레이 허용
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_overlay_validate BEFORE INSERT OR UPDATE ON app.overlays
  FOR EACH ROW EXECUTE FUNCTION app.validate_overlay();
```
> **불변 필드(수정 불가)**: `building_pk · pnu · addr · road_addr · jibun_norm · geom · lng · lat · sgg_code · bjd_code`. **그 외 마스터 전 필드 = 오버레이 수정 가능.** (마이그레이션 `db/migrations/0010`)

---

## 5. 각 레이어가 레지스트리를 읽는 법 (한 곳만 고치면 되는 이유)

| 소비자 | 읽는 것 | 효과 |
|---|---|---|
| **파이프라인 loader** | `fields WHERE layer='public'`의 `source_ref` | CSV↔컬럼 매핑 자동 |
| **building_view / API 직렬화** | `fields WHERE active` (+`masked`) | 새 필드 자동 노출, 마스킹 자동 |
| **프론트 필드 컴포넌트** | `fields`(label·unit·data_type·display_group·order) | 화면 하드코딩 없이 **메타로 자동 렌더** |
| **S01b 필터** | `fields WHERE searchable` + `enums` | 필터 항목·옵션 자동 |
| **가치점수/적정매매가 계산** | `formula_params WHERE set_version=active` | 가중치 데이터 구동, 배포 없이 튜닝 |
| **오버레이 수정** | `fields.editable` + `enums` 검증(트리거) | 잘못된 필드·값 원천 차단 |

> **결과**: 새 공공 필드 = `ref.fields` 1행 + (master 물리컬럼 1개). enum 값·산식 가중치 = INSERT(배포 0). 사적 필드 = `ref.fields` 1행(오버레이 EAV라 스키마 0).

---

## 6. 열린 항목
- `assignee`처럼 **참조형(팀 멤버)** 필드의 레지스트리 표현(현재 예외 처리) — 참조 타입 `ref` 추가 검토.
- 빌탐정 자체 enum(grade·ipji 등) **저장 code 확정**(현재 provisional) — `enums.md` 열린항목과 동일.
- `source_ref` 표기 규약(파일.컬럼) 표준화 — 컬럼정의서 매핑 일괄 이관 시.
- 파생 필드 의존성(그래프) 관리: F-17이 F-16을 참조 등 — 재계산 순서용.
