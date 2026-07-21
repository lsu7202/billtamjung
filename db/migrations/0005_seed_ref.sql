-- 0005_seed_ref.sql — 레지스트리 시드(enum·필드·산식)
-- 근거: specs/04-data/schema-ref.md 시드 · enums.md · formulas.md · codes-vworld.md
BEGIN;

-- ── enum 그룹 ────────────────────────────────────────
INSERT INTO ref.enum_groups(enum_key,label,two_tier) VALUES
 ('use_zone','용도지역',false), ('main_use','주용도',true),
 ('land_use','토지이용상황',false), ('grade','등급',false),
 ('ipji','입지',false), ('meongdo','명도',false),
 ('use_change','용도변경',false), ('myeolsil','멸실',false),
 ('nohudo','노후도',false), ('jindo','진행상태',false),
 ('owner_type','소유자타입',false)
ON CONFLICT (enum_key) DO NOTHING;

-- ── 용도지역(LMIS UQA 정본) ─────────────────────────
INSERT INTO ref.enums(enum_key,code,label,sort_order) VALUES
 ('use_zone','UQA110','전용주거지역',10), ('use_zone','UQA121','제1종일반주거지역',20),
 ('use_zone','UQA122','제2종일반주거지역',30), ('use_zone','UQA123','제3종일반주거지역',40),
 ('use_zone','UQA130','준주거지역',50), ('use_zone','UQA210','중심상업지역',60),
 ('use_zone','UQA220','일반상업지역',70), ('use_zone','UQA230','근린상업지역',80),
 ('use_zone','UQA240','유통상업지역',90), ('use_zone','UQA330','준공업지역',100),
 ('use_zone','UQA500','도시지역미지정',110)
ON CONFLICT DO NOTHING;

-- ── 주용도(우선순위 2단) ────────────────────────────
INSERT INTO ref.enums(enum_key,code,label,sort_order,tier) VALUES
 ('main_use','02000','공동주택',10,'primary'), ('main_use','14000','업무시설',20,'primary'),
 ('main_use','03000','제1종근린생활시설',30,'primary'), ('main_use','04000','제2종근린생활시설',40,'primary'),
 ('main_use','01000','단독주택',50,'secondary'), ('main_use','33000','국방·군사시설',60,'secondary')
ON CONFLICT DO NOTHING;

-- ── 빌탐정 자체 지표(코드 provisional) ──────────────
INSERT INTO ref.enums(enum_key,code,label,sort_order) VALUES
 ('grade','A','매우좋음',10),('grade','B','좋음',20),('grade','C','나쁨',30),('grade','D','매우나쁨',40),('grade','U','미지정',99),
 ('ipji','A','매우좋음',10),('ipji','B','좋음',20),('ipji','C','보통',30),('ipji','D','나쁨',40),('ipji','U','미지정',99),
 ('meongdo','done','완료',10),('meongdo','able','가능',20),('meongdo','unable','불가',30),('meongdo','part','일부',40),('meongdo','cond','조건부',50),('meongdo','U','미지정',99),
 ('nohudo','good','양호',10),('nohudo','normal','보통',20),('nohudo','old','노후',30),('nohudo','U','미지정',99),
 ('jindo','ready','준비중',10),('jindo','ongoing','진행중',20),('jindo','offered','가격제시',30),('jindo','sold','매각',40),('jindo','withdrawn','철회',50),
 ('owner_type','person','개인',10),('owner_type','corp','법인',20),('owner_type','U','미지정',99)
ON CONFLICT DO NOTHING;

-- ── 필드 레지스트리 ──────────────────────────────────
INSERT INTO ref.fields
 (field_key,label,unit,data_type,layer,target,source_ref,enum_key,formula_id,editable,masked,searchable,in_report,display_group,display_order) VALUES
 ('gongsi','공시지가','만원/㎡','series','public','parcel','gongsi_series',NULL,NULL,true,false,true,true,'land',10),
 ('use_zone','용도지역',NULL,'enum','public','parcel','parcels_v1.uqa','use_zone',NULL,true,false,true,true,'land',20),
 ('land_area','토지면적','㎡','num','public','parcel','parcels_v1.area',NULL,NULL,true,false,true,true,'land',30),
 ('far','용적률','%','num','public','building','buildings_v1.far',NULL,NULL,true,false,true,true,'building',40),
 ('main_use','주용도',NULL,'enum','public','building','buildings_v1.main_use','main_use',NULL,true,false,true,true,'building',50),
 ('meongdo','명도',NULL,'enum','private','building',NULL,'meongdo',NULL,true,false,true,false,'detail',10),
 ('nohudo','노후도',NULL,'enum','private','building',NULL,'nohudo',NULL,true,false,true,false,'detail',20),
 ('assignee','담당자',NULL,'text','private','building',NULL,NULL,NULL,true,false,true,false,'biz',10),
 ('owner_phone','전화번호',NULL,'text','private','building',NULL,NULL,NULL,true,true,false,false,'biz',90),
 ('value_score','가치점수',NULL,'num','derived','building',NULL,NULL,'F-16',false,false,false,true,'report',10)
ON CONFLICT (field_key) DO NOTHING;

-- ── 산식 파라미터(F-16 가중치·등급컷 등) ────────────
INSERT INTO ref.formula_sets(set_version,effective_from,active,note)
 VALUES (1,'2026-07-01',true,'초기 가중치(formulas.md)')
ON CONFLICT (set_version) DO NOTHING;

INSERT INTO ref.formula_params(set_version,formula_id,param_key,value_num) VALUES
 (1,'F-16','weight.road_access',18), (1,'F-16','weight.station_dist',18),
 (1,'F-16','weight.use_zone',18),    (1,'F-16','weight.shape',15),
 (1,'F-16','weight.approval_date',13),(1,'F-16','weight.elevator',8),
 (1,'F-16','weight.remodel',8),      (1,'F-16','weight.slope',2),
 (1,'F-16','grade_cut.S',90), (1,'F-16','grade_cut.A',75), (1,'F-16','grade_cut.B',60),
 (1,'F-17','similarity.floor',0.3)
ON CONFLICT DO NOTHING;

INSERT INTO ref.formula_params(set_version,formula_id,param_key,value_json) VALUES
 (1,'F-17','time_adjust','{"2021":0.12,"2022":0.05,"2023":-0.02,"2024":0.03,"2025":0.04,"2026":0.0}')
ON CONFLICT DO NOTHING;

COMMIT;
