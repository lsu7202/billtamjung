"""원천별 단위(unit) 선언 — 「무엇을 언제 돌리나」를 아는 한 곳(2026-09-06).

정본 계획: specs/07-architecture/07-원천별-증분-파이프라인.md
실행기:   scripts/run_unit.py --list · --unit news.press · --cadence weekly

단위 하나 = 원천 하나. 지금까지는 소식 하나를 갱신해도 `run_pipeline.sh` 가 대장 전체 빌드까지
같이 돌았다(디스크 25GB · 몇 시간). 단위로 나누면 주간 소식은 5분이다.

칸:
    cadence   weekly | monthly | quarterly | semiannual | yearly
    crawl     받기. `--no-crawl` 로 끌 수 있다
    load      적재 — 이 단위의 표를 채운다
    inputs    입력 지문을 잴 파일(glob). 지문이 장부와 같으면 적재를 건너뛴다(--force 로 무시)
    sig_sql   파일이 아니라 표가 지문인 경우(보도자료는 받으면서 바로 적재한다)
    table     적재 뒤 줄 수를 세어 장부에 남길 표

한 단계(step)는 dict(py=..., cmd=[...], need=...):
    py    "gis"(data/.venv · pyshp·pyproj·shapely) | "app"(backend/.venv · asyncpg). 섞으면
          ModuleNotFoundError 로 조용히 건너뛴다 — run_pipeline.sh 가 겪은 함정이다
    need  없으면 그 단계를 건너뛸 파일

파생(DERIVES)은 읽는 것(reads)을 선언한다. 실행기는 이번에 판이 오른 것을 읽는 파생만 돈다.
"""
from __future__ import annotations


def S(cmd: list[str], py: str = "app", need: str | None = None) -> dict:
    return dict(cmd=cmd, py=py, need=need)


# ── 단위 ────────────────────────────────────────────────────────────────
UNITS: dict[str, dict] = {
    # 소식 — 원천마다 따로(대표 「더 세분화」). 주간 셋은 증분이라 1분씩이다
    "news.notice": dict(
        cadence="weekly", label="고시(서울도시공간포털)",
        crawl=[S(["scripts/urban/fetch_notices.py", "--pages", "3"], "gis")],
        load=[S(["scripts/load_urban_notice.py"], "app", "data/raw/_urban_notice/notices.jsonl")],
        inputs=["data/raw/_urban_notice/notices.jsonl"], table="master.urban_notice",
        verify=[
            ("고시 4만 줄 이상",
             "select count(*)>=40000, to_char(count(*),'999,999') from master.urban_notice"),
            ("고시일 있는 줄 99% 이상",
             "select 100.0*count(notice_date)/nullif(count(*),0)>=99,"
             " round(100.0*count(notice_date)/nullif(count(*),0),1)||'%' from master.urban_notice"),
        ],
    ),
    "news.press": dict(
        cadence="weekly", label="보도자료(서울시)",
        # 받으면서 바로 표에 넣는다(사실만 · 본문 저장 안 함) — 적재 단계가 따로 없다
        crawl=[S(["scripts/press/fetch_press.py", "--pages", "5"], "gis")],
        sig_sql="select count(*)||':'||coalesce(max(ntt_no)::text,'-') from master.press_event",
        table="master.press_event",
        verify=[
            # 보도자료 본문은 저장하지 않는다(공공누리 4유형). 칸이 생기면 그 자리에서 막는다
            ("본문 칸이 없을 것",
             "select count(*)=0, coalesce(string_agg(column_name,','),'없음')"
             " from information_schema.columns where table_schema='master'"
             " and table_name='press_event' and column_name in ('body','content')"),
            ("2,000줄 이상",
             "select count(*)>=2000, to_char(count(*),'999,999') from master.press_event"),
            ("태그 붙은 줄 90% 이상",
             "select 100.0*count(tags)/nullif(count(*),0)>=90,"
             " round(100.0*count(tags)/nullif(count(*),0),1)||'%' from master.press_event"),
        ],
    ),
    "news.g2b": dict(
        cadence="weekly", label="공사 발주(나라장터)",
        crawl=[S(["scripts/g2b/fetch_bids.py", "--days", "30", "--seoul"], "gis")],
        load=[S(["scripts/load_g2b.py"], "app", "data/raw/_g2b/bids_cnstwk.json")],
        inputs=["data/raw/_g2b/bids_cnstwk.json"], table="master.g2b_bid",
        verify=[
            ("공고 4,000건 이상",
             "select count(*)>=4000, to_char(count(*),'999,999') from master.g2b_bid"),
        ],
    ),
    "news.facility": dict(
        cadence="monthly", label="도시계획시설 SHP 4종(서울 열린데이터광장)",
        crawl=[S(["scripts/seoul_gis/download_gis.py"], "gis")],
        load=[S(["scripts/load_city_facility.py"], "gis", "data/raw/_seoul_gis")],
        inputs=["data/raw/_seoul_gis/*"], table="master.city_facility",
        verify=[
            ("도시계획시설 2만 줄 이상",
             "select count(*)>=20000, to_char(count(*),'999,999') from master.city_facility"),
        ],
    ),
    "news.permit": dict(
        cadence="quarterly", label="건축 인허가·철거(건축HUB)",
        # 원본 폴더는 압축돼 사라진다 — 문지기도 적재도 압축본을 본다
        load=[S(["scripts/load_building_permit.py"], "app",
                "data/raw/_archive/hub_seoul/인허가_기본개요.tar.zst")],
        inputs=["data/raw/_archive/hub_seoul/인허가_*.tar.zst"], table="master.building_permit",
        verify=[
            ("인허가 60만 줄 이상",
             "select count(*)>=600000, to_char(count(*),'999,999') from master.building_permit"),
            ("PNU 있는 줄 90% 이상",
             "select 100.0*count(pnu)/nullif(count(*),0)>=90,"
             " round(100.0*count(pnu)/nullif(count(*),0),1)||'%' from master.building_permit"),
        ],
    ),
    "news.zones": dict(
        cadence="semiannual", label="정비구역·지구단위계획(V-World)",
        # 받기가 없어 「수동」이었다(2026-09-07). UD602/603 은 LSMD 데이터셋 30335/30337, 지구단위계획은 --misc 30115
        crawl=[S(["scripts/vworld/download_vworld.py", "--only", "30335,30337", "--out", "data/raw/_dl"], "gis"),
               S(["scripts/vworld/download_vworld.py", "--misc", "--only", "30115", "--out", "data/raw/_dl"], "gis"),
               S(["scripts/activate.py"], "gis")],
        load=[S(["scripts/vworld/load_redevel_zones.py"], "gis", "data/raw/LSMD_CONT_UD602_서울"),
              S(["scripts/vworld/load_district_plans.py"], "gis", "data/raw/C_UQ161")],
        inputs=["data/raw/LSMD_CONT_UD602_서울/*", "data/raw/C_UQ161/*"], table="master.building_redevel",
        verify=[
            ("정비구역 붙은 건물 10만 동 이상",
             "select count(*)>=100000, to_char(count(*),'999,999') from master.building_redevel"),
        ],
    ),

    # 업체 명부 — 층별 임대 상호명·상권 7갈래의 재료
    "stores.localdata": dict(
        cadence="monthly", label="LOCALDATA 208업종",
        crawl=[S(["scripts/localdata/download_localdata.py"], "gis")],
        load=[S(["scripts/load_localdata.py"], "gis", "data/raw/_localdata")],
        inputs=["data/raw/_localdata/*"], table="master.localdata_permit",
        verify=[
            ("영업 인허가 300만 줄 이상",
             "select count(*)>=3000000, to_char(count(*),'999,999,999') from master.localdata_permit"),
            # 실측 20.3%(2026-09-07). 208업종 전체라 층을 안 적는 업종이 많다 —
            # 층별 임대가 읽는 건 그중 상가 업종이고 거기선 훨씬 높다. 기준은 실측에 맞춘다
            ("층 정보 있는 줄 60만 이상",
             "select count(floor_no)>=600000, to_char(count(floor_no),'999,999')"
             " from master.localdata_permit"),
        ],
    ),
    "stores.sbiz": dict(
        cadence="quarterly", label="소상공인 상가정보",
        # 받기만 있고 옮기는 마디가 없었다(2026-09-07 추적). zip 은 _dl 에 떨어지고 activate 가 서울 CSV 만 _sbiz 로
        crawl=[S(["scripts/datagokr/download_datagokr.py", "--out", "data/raw/_dl",
                  "--only", "15083033"], "gis"),
               S(["scripts/activate.py"], "gis")],
        load=[S(["scripts/load_sbiz.py", "data/raw/_sbiz"], "app", "data/raw/_sbiz")],
        inputs=["data/raw/_sbiz/*"], table="master.sbiz_store",
        verify=[
            ("상가 50만 줄 이상",
             "select count(*)>=500000, to_char(count(*),'999,999') from master.sbiz_store"),
            ("좌표 있는 줄 95% 이상",
             "select 100.0*count(geom)/nullif(count(*),0)>=95,"
             " round(100.0*count(geom)/nullif(count(*),0),1)||'%' from master.sbiz_store"),
        ],
    ),

    # 승강기 — 별도 원천(공공데이터포털 15112638)이라 자기 단위로 선다.
    # 대장 빌드 안의 한 칸으로 두면 승강기만 갱신하려 해도 28단계를 다시 돌아야 한다(2026-09-07).
    "elevator": dict(
        cadence="quarterly", label="승강기 설치현황(한국승강기안전공단)",
        # zip 은 _dl 에 떨어진다 — activate 가 안 풀면 원본 CSV 가 옛것으로 남는다
        crawl=[S(["scripts/datagokr/download_datagokr.py", "--out", "data/raw/_dl",
                  "--only", "15112638"], "gis"),
               S(["scripts/activate.py"], "gis")],
        load=[S(["scripts/load_elevator_ext.py"], "app",
                "data/raw/한국승강기안전공단_승강기 설치 현황_2016년 이후.csv")],
        inputs=["data/raw/한국승강기안전공단_승강기 설치 현황_*.csv"],
        table="master.buildings",
        verify=[
            # 0156 로 칸만 만들고 값이 한 번도 안 찼다. 그걸 다시 못 넘어가게 잰다
            ("붙은 건물 10만 동 이상",
             "select count(elevator_ext)>=100000, to_char(count(elevator_ext),'999,999')"
             " from master.buildings"),
            ("대장이 비어 화면에 참조로 설 건물 3만 동 이상",
             "select count(*)>=30000, to_char(count(*),'999,999') from master.buildings"
             " where elevator is null and elevator_ext is not null"),
        ],
    ),

    # 공시지가 — 연 1회(5월 말). **원천별 분리의 본보기**(2026-09-07).
    # 예전엔 build_land_master 안의 한 함수라, 공시지가만 갱신하려 해도 대장 28단계를 다 돌았다.
    # 시계열은 공간 조인이 필요 없어 D150 dbf 에서 바로 뽑는다 — build_gongsi_series.py.
    "gongsi": dict(
        cadence="yearly", label="개별공시지가(V-World D150 + 옛 CSV)",
        # 공시지가·토지특성은 NA 카탈로그다 — `--na` 없이 부르면 데이터셋을 못 찾는다(2026-09-07 실측)
        crawl=[S(["scripts/vworld/download_vworld.py", "--na", "--only", "6",
                  "--out", "data/raw/_dl"], "gis"),
               S(["scripts/activate.py"], "gis")],
        build=[S(["scripts/build_gongsi_series.py",
                  "--out", "data/exports/_load/gongsi_series.csv"], "gis")],
        load=[S(["pipeline/loader.py", "--source", "gongsi_series",
                 "--csv", "data/exports/_load/gongsi_series.csv"], "app",
                "data/exports/_load/gongsi_series.csv"),
              # 화면·파생이 읽는 건 건물 표의 gongsi_latest 칸이다. 그건 대장 빌드가 굽는 값이라
              # 시계열만 갈면 옛것으로 남는다 — 적재 뒤에 되붙인다(승강기·용도지역과 같은 자리)
              S(["scripts/fill_gongsi_latest.py"], "app")],
        inputs=["data/raw/*D150*/*.dbf", "data/raw/공시지가_*년.csv"],
        table="master.gongsi_series",
        verify=[
            # 한 해가 통째로 빠지는 사고가 실제로 있었다(2026-08-31: 26년치 → 11년치).
            ("연도 구간 1990~2026",
             "select min(year)=1990 and max(year)=2026, min(year)||'~'||max(year)"
             " from master.gongsi_series"),
            ("빠진 연도 없음",
             "select count(*)=0, coalesce(string_agg(y::text,','),'없음') from ("
             "  select generate_series(1990,2026) y except select distinct year"
             "    from master.gongsi_series) z"),
            ("줄수 2,800만 이상",
             "select count(*)>=28000000, to_char(count(*),'999,999,999') from master.gongsi_series"),
            ("올해 값 있는 필지 88만 이상",
             "select count(*)>=880000, to_char(count(*),'999,999')"
             " from master.gongsi_series where year=2026"),
            # 필지 원장과 붙는지. 안 붙으면 화면의 공시지가 칸이 통째로 빈다
            # 되붙임이 빠지면 시계열은 새것인데 건물 값은 옛것으로 남는다
            ("건물의 gongsi_latest 가 시계열과 같을 것",
             "select count(*)=0, count(*)::text||'동' from master.buildings b"
             "  join (select distinct on (pnu) pnu, price from master.gongsi_series"
             "         order by pnu, year desc) l on l.pnu=b.pnu"
             " where b.gongsi_latest is distinct from l.price"),
            ("필지의 gongsi_latest 도 시계열과 같을 것",
             "select count(*)=0, count(*)::text||'필지' from master.parcels p"
             "  join (select distinct on (pnu) pnu, price from master.gongsi_series order by pnu, year desc) l"
             "    using (pnu) where p.gongsi_latest is distinct from l.price"),
            ("필지 원장에 붙는 비율 95% 이상",
             "select 100.0*count(g.pnu)/nullif(count(*),0) >= 95,"
             " round(100.0*count(g.pnu)/nullif(count(*),0),1)||'%'"
             " from master.parcels p left join (select distinct pnu from master.gongsi_series"
             "   where year=2026) g on g.pnu=p.pnu"),
        ],
    ),

    # 도로폭 — 도로명주소 도로구간. 부품은 다 있었고 단위 선언만 없었다(2026-09-07).
    # ledger 단위 적재 줄에도 같은 load_road_width 가 걸려 있다(되붙임은 두 곳).
    "road_width": dict(
        cadence="semiannual", label="도로명주소 도로구간 → 폭원",
        # activate.py 는 data/raw/_dl 을 훑는다 — 받기를 거기로 보내야 이어진다(crawl_all 과 같은 경로)
        crawl=[S(["scripts/vworld/download_vworld.py", "--sido", "--out", "data/raw/_dl"], "gis"),
               S(["scripts/activate.py"], "gis")],          # _dl → (도로명주소)도로구간_서울
        build=[S(["data/tools/build_road_width.py"], "gis",
                 "data/raw/(도로명주소)도로구간_서울/TL_SPRD_MANAGE.Seoul.shp")],
        load=[S(["scripts/load_road_width.py"], "app", "data/tools/_road_width.csv")],
        inputs=["data/raw/(도로명주소)도로구간_서울/TL_SPRD_MANAGE.Seoul.*"],
        table="master.road_segment",
        verify=[
            ("도로 6만 구간 이상",
             "select count(*)>=60000, to_char(count(*),'999,999') from master.road_segment"),
            ("폭원 붙은 건물 45만 이상",
             "select count(*)>=450000, to_char(count(*),'999,999') from master.building_road"),
        ],
    ),

    # 생활인구 — 받기·적재 스크립트가 다 있는데 아무도 안 불렀다(2026-09-07). building_pop 은 적정가가 읽는다.
    "living_pop": dict(
        cadence="monthly", label="서울 생활인구 250m 격자(한 주 평균)",
        crawl=[S(["scripts/seoul_open/download_living_pop.py", "--days", "7"], "gis")],
        # 둘 다 psycopg(RENT_DSN) — gis venv. app 으로 두면 ModuleNotFoundError(2026-09-07 실제)
        load=[S(["scripts/seoul_open/load_living_pop.py", "--dir", "data/raw/_living_pop"], "gis",
                "data/raw/_living_pop"),
              S(["scripts/seoul_open/match_building_pop.py"], "gis")],
        inputs=["data/raw/_living_pop/*.zip"], table="master.living_pop",
        verify=[
            ("격자 8,000 이상",
             "select count(*)>=8000, to_char(count(*),'999,999') from master.living_pop"),
            ("건물에 붙은 것 50만 동 이상",
             "select count(*)>=500000, to_char(count(*),'999,999') from master.building_pop"),
            # 강·산 격자는 낮 인구가 0 이 맞다(실측 7). 절반 넘게 비면 원천이 깨진 것
            ("낮 인구 있는 격자 99% 이상",
             "select 100.0*count(*) filter (where day_avg>0)/nullif(count(*),0)>=99,"
             " round(100.0*count(*) filter (where day_avg>0)/nullif(count(*),0),1)||'%' from master.living_pop"),
        ],
    ),

    # 상권분석서비스 — 받는 경로와 읽는 경로가 달랐다. 압축 푸는 마디를 여기 둔다(2026-09-07).
    "trade_area": dict(
        cadence="semiannual", label="서울시 상권분석서비스 영역(전통시장 판정)",
        crawl=[S(["scripts/seoul_open/download_trade_area.py", "--out", "data/raw/_trade_area_dl"], "gis"),
               S(["bash", "-c", "unzip -o -q data/raw/_trade_area_dl/*.zip"
                  " -d 'data/raw/서울시 상권분석서비스(영역-상권)'"], "gis")],
        load=[S(["scripts/sanggwon/load_seoul_trade_area.py"], "gis",       # psycopg(RENT_DSN)
                "data/raw/서울시 상권분석서비스(영역-상권)/sanggwon.shp")],
        inputs=["data/raw/서울시 상권분석서비스(영역-상권)/sanggwon.*"], table="master.trade_area",
        verify=[
            ("상권 1,600 이상",
             "select count(*)>=1600, to_char(count(*),'999,999') from master.trade_area"),
            ("갈래 넷(골목·발달·전통시장·관광특구)",
             "select count(distinct kind)=4, string_agg(distinct kind_nm, '·') from master.trade_area"),
        ],
    ),

    # 교통 — 역사마스터·버스정류소(반기). 값이 buildings 의 칸이라 승강기처럼 되붙인다(2026-09-07).
    # 받기는 _transit_dl 에 떨어지는데 빌더·적재는 data/raw/ 바로 밑을 읽는다 — 복사 마디를 둔다.
    "transit": dict(
        cadence="semiannual", label="지하철역·버스정류소 → 역거리·주변 교통",
        crawl=[S(["scripts/seoul_open/download_transit.py", "--out", "data/raw/_transit_dl"], "gis"),
               S(["bash", "-c", "cp data/raw/_transit_dl/*.json data/raw/"], "gis")],
        build=[S(["data/tools/build_transit.py", "ALL"], "gis", "data/raw/서울시 역사마스터 정보.json")],
        load=[S(["scripts/transit/load_stations.py"], "app", "data/raw/서울시 역사마스터 정보.json"),
              S(["scripts/fill_transit.py"], "app", "data/tools/_transit_ALL.jsonl")],
        inputs=["data/raw/서울시 역사마스터 정보.json", "data/raw/서울시 버스정류소 위치정보.json"],
        table="master.subway_stations",
        verify=[
            ("역 700 이상",
             "select count(*)>=700, count(*)::text from master.subway_stations"),
            ("역거리 있는 건물 90% 이상",
             "select 100.0*count(station_dist)/nullif(count(*),0)>=90,"
             " round(100.0*count(station_dist)/nullif(count(*),0),1)||'%' from master.buildings"),
            ("역거리 중앙값 200~1500m",
             "select percentile_cont(0.5) within group (order by station_dist) between 200 and 1500,"
             " round(percentile_cont(0.5) within group (order by station_dist))||'m' from master.buildings"),
        ],
    ),

    # 필지 — 지적도·용도지역·토지특성·토지이용계획(반기). 대장 빌드 1~2단계와 luris 를 자기 단위로 떼었다(2026-09-07).
    # spatial_join 이 무겁다(89.8만 필지 × 용도지역). _spatial_ALL.json·_land_master.jsonl 은 대장 빌드도 읽으므로
    # 여기서 새로 만들면 다음 대장 빌드가 그걸 쓴다. building_pk 는 SQLite 대신 살아 있는 DB 에서(--pk-from-db).
    "parcels": dict(
        cadence="semiannual", label="필지 원장(지적도·토지특성·용도지역·토지이용계획)",
        crawl=[S(["scripts/vworld/download_vworld.py", "--out", "data/raw/_dl"], "gis"),            # LSMD 9종
               S(["scripts/vworld/download_vworld.py", "--na", "--out", "data/raw/_dl"], "gis"),    # 토지특성 D194
               S(["scripts/vworld/download_vworld.py", "--only", "14", "--out", "data/raw/_dl"], "gis"),  # KLIP D155
               S(["scripts/activate.py"], "gis")],
        build=[S(["data/tools/spatial_join.py", "ALL"], "gis", "data/raw/LSMD_CONT_LDREG_5174_서울"),
               S(["data/tools/build_land_master.py"], "gis", "data/tools/_spatial_ALL.json"),
               S(["data/tools/build_annex.py", "ALL"], "gis"),                      # 부속지번 마트는 hub_csv 가 압축본에서 편다
               S(["pipeline/export_parcels.py", "--pk-from-db",
                  "--parcels", "data/exports/_load/parcels.csv",
                  "--annex", "data/exports/_load/building_parcels.csv"], "gis", "data/tools/_annex_ALL.json"),
               S(["data/tools/build_luris.py"], "gis", "data/raw/토지이용계획정보_서울")],
        load=[S(["pipeline/loader.py", "--source", "parcels", "--csv", "data/exports/_load/parcels.csv"], "app",
                "data/exports/_load/parcels.csv"),
              S(["pipeline/loader.py", "--source", "building_parcels", "--csv", "data/exports/_load/building_parcels.csv"],
                "app", "data/exports/_load/building_parcels.csv"),
              S(["scripts/load_parcel_luris.py"], "app", "data/exports/luris/parcel_luris.csv.gz"),
              S(["scripts/fill_building_parcels.py"], "app"),
              # 새 필지 표는 빌드 시점 공시지가로 태어난다 — 시계열 정본으로 덮는다(2026-09-07: 17필지 어긋남)
              S(["scripts/fill_gongsi_latest.py"], "app")],
        inputs=["data/raw/LSMD_CONT_LDREG_5174_서울/*.shp", "data/raw/LSMD_CONT_UQ111_5174_서울/*.shp",
                "data/raw/토지특성/*/*.dbf", "data/raw/토지이용계획정보_서울/*.csv"],
        table="master.parcels",
        verify=[
            ("필지 89만 이상",
             "select count(*)>=890000, to_char(count(*),'999,999') from master.parcels"),
            ("용도지역 95% 이상",
             "select 100.0*count(use_zone)/nullif(count(*),0)>=95,"
             " round(100.0*count(use_zone)/nullif(count(*),0),1)||'%' from master.parcels"),
            ("법정 건폐·용적 95% 이상",
             "select 100.0*count(legal_bcr)/nullif(count(*),0)>=95,"
             " round(100.0*count(legal_bcr)/nullif(count(*),0),1)||'%' from master.parcels"),
            ("규제 95% 이상",
             "select 100.0*count(regulations)/nullif(count(*),0)>=95,"
             " round(100.0*count(regulations)/nullif(count(*),0),1)||'%' from master.parcels"),
            ("건물↔필지 연결 68만 이상",
             "select count(*)>=680000, to_char(count(*),'999,999') from master.building_parcels"),
            ("연결 없는 건물 1만 동 이하",
             "select count(*)<=10000, to_char(count(*),'999,999') from master.buildings b"
             " where not exists (select 1 from master.building_parcels p where p.building_pk=b.building_pk)"),
        ],
    ),

    # 실거래·지가·임대동향
    "sales": dict(
        cadence="monthly", label="실거래(RTMS)",
        crawl=[S(["bash", "data/tools/download_rtms.sh"], "gis")],
        build=[S(["data/tools/build_sales.py"], "gis"),
               S(["pipeline/export_series.py", "data/exports/_load/gongsi_series.csv",
                  "data/exports/_load/sales_history.csv"], "app")],
        load=[S(["pipeline/loader.py", "--source", "sales_history",
                 "--csv", "data/exports/_load/sales_history.csv"], "app",
                "data/exports/_load/sales_history.csv"),
              # 건물 표의 마지막 매각 두 칸은 대장 빌드가 굽는 값 — 실거래만 갈면 90일 묵는다(되붙임)
              S(["scripts/fill_sale_latest.py"], "app")],
        inputs=["data/raw/실거래가/*"], table="master.sales_history",
        verify=[
            ("11만 줄 이상",
             "select count(*)>=110000, to_char(count(*),'999,999') from master.sales_history"),
            # 2026-09-06: 2016년 원본이 오류 페이지로 받아져 한 해에서만 7,518줄이 빠졌다.
            # 한 해라도 500건 밑이면 원본을 의심한다
            ("건물의 마지막 매각가가 실거래 최신과 같을 것",
             "select count(*)=0, count(*)::text||'동' from master.buildings b"
             "  join (select distinct on (building_pk) building_pk, contract_ym, price"
             "          from master.sales_history where price>0 order by building_pk, contract_ym desc) l"
             "    using (building_pk)"
             " where b.last_sale_price is distinct from l.price"),
            ("연도별 구멍 없음(각 500건 이상)",
             "select count(*)=0, coalesce(string_agg(yr||'('||n||')',','),'없음') from ("
             "  select left(contract_ym,4) yr, count(*) n from master.sales_history"
             "   where left(contract_ym,4)::int between 2007 and 2025"
             "   group by 1 having count(*)<500) z"),
        ],
    ),
    "land_adjust": dict(
        cadence="monthly", label="지가변동률(R-ONE)",
        crawl=[S(["scripts/rone/download_jiga.py", "--out", "data/raw/_dl"], "gis")],
        load=[S(["scripts/rent_estimate/build_land_adjust.py"], "app",
                "data/raw/(연) 지역별 지가변동률.json")],
        inputs=["data/raw/(연) 지역별 지가변동률.json"], table="master.land_adjust",
        verify=[
            ("지가변동률 300줄 이상",
             "select count(*)>=300, to_char(count(*),'999,999') from master.land_adjust"),
        ],
    ),
    "rent_index": dict(
        cadence="quarterly", label="상업용 임대동향(R-ONE)",
        crawl=[S(["scripts/rone/download_rone.py", "--out", "data/raw/_dl"], "gis")],
        load=[S(["scripts/rent_estimate/build_series.py"], "app")],
        inputs=["data/raw/_dl/*임대동향*", "data/raw/*임대동향*"], table="master.sanggwon_rent_series",
        verify=[
            ("임대동향 2만 줄 이상",
             "select count(*)>=20000, to_char(count(*),'999,999')"
             " from master.sanggwon_rent_series"),
        ],
    ),

    # 대장 — 유일한 전체 빌드. 디스크 여유 40GB 를 먼저 재고 시작한다(2026-09-06 ENOSPC)
    "ledger": dict(
        cadence="quarterly", label="건축HUB 대장 전체(전체 빌드)",
        crawl=[S(["scripts/hub/download_seoul.py"], "gis")],
        # **압축본을 먼저 편다.** build_all.py 는 `data/raw/_archive` 를 모르고 `data/raw/hub_seoul` 만 본다.
        # 안 펴면 빌드가 「자료 없음」으로 조용히 넘어가고 표가 통째로 빈다(637MB → 약 11GB).
        build=[S(["scripts/hub/archive_seoul.py", "--restore"], "gis"),
               S(["pipeline/build_all.py", "--export-dir", "data/exports/_load"], "gis")],
        load=[S(["pipeline/loader.py", "--source", s, "--csv", f"data/exports/_load/{c}"],
                "app", f"data/exports/_load/{c}")
              for s, c in (("buildings", "buildings.csv"), ("parcels", "parcels.csv"),
                           ("building_parcels", "building_parcels.csv"),
                           ("gongsi_series", "gongsi_series.csv"),
                           ("sales_history", "sales_history.csv"), ("complex", "complex.csv"),
                           ("unit", "unit.csv"), ("energy", "energy.csv"), ("zone", "zone.csv"),
                           ("closed", "closed.csv"), ("basic", "basic.csv"), ("septic", "septic.csv"))]
             # 이 셋은 로더의 세대 스왑을 안 쓴다(파생 계산의 입력이라 TRUNCATE+INSERT 전용 스크립트).
             # 문지기 경로가 틀리면 조용히 건너뛰고 표가 빈 채 남는다 — 2026-08-09 road_segment 사고.
             + [S(["scripts/load_parcel_luris.py"], "app", "data/exports/luris/parcel_luris.csv.gz"),
                S(["scripts/load_road_width.py"], "app", "data/tools/_road_width.csv"),
                S(["scripts/load_floor_outline.py"], "app", "data/tools/_floor_outline.csv"),
                # 총괄표제부가 없는 건물의 필지 연결을 메운다. 적재 뒤라야 한다
                S(["scripts/fill_building_parcels.py"], "app"),
                # 승강기 참조값도 대장 CSV 에 없다 — 새 세대를 실었으면 다시 붙여야 한다
                S(["scripts/load_elevator_ext.py"], "app",
                  "data/raw/한국승강기안전공단_승강기 설치 현황_2016년 이후.csv"),
                # 대장이 굽는 gongsi_latest 는 현 지적도 필지만 담는다 — 시계열 정본으로 덮는다
                S(["scripts/fill_gongsi_latest.py"], "app"),
                # 마지막 매각도 대장이 굽는 추정 매칭값 — 실거래 정본으로 덮는다
                S(["scripts/fill_sale_latest.py"], "app"),
                # 표제부 원문 48키를 그대로 보유한다(0164) — 화면은 안 읽고 AI·분석만 읽는다.
                # 빌더가 내는 21키가 build_integrated 에서 끊겨 어느 표에도 없던 것을 여기서 살린다
                S(["scripts/load_ledger_raw.py"], "app", "data/tools/_building_master.jsonl")],
        inputs=["data/raw/_archive/hub_seoul/*.tar.zst"], table="master.buildings",
        full_build=True, min_free_gb=40,
        # 빌드가 끝나면 바로 치운다 — 적재가 새 세대를 쓰는 구간이 디스크가 가장 위험하다.
        # jsonl 은 빌드 안에서만 쓰이고 적재는 안 읽는다. exports 는 적재가 읽으므로 그 뒤에.
        # 공시지가 원본(data/raw/*D150*)·옛 CSV 는 **여기 넣지 말 것** — build_land_master 가 직접 훑는다.
        # 지우면 다음 재빌드에서 2016~2026 이 통째로 빠진다(2026-08-31 에 같은 사고).
        # **`_*.jsonl` 을 통째로 치우면 안 된다.** 둘은 다른 단위가 읽는 입력이다:
        #   _building_master.jsonl → data/tools/build_sales.py (sales 단위)
        #   _land_master.jsonl     → pipeline/export_series.py (sales 단위)
        # 2026-09-06 에 통째로 치웠다가 sales 단위가 FileNotFoundError 로 죽었다. 나머지 아홉만 치운다.
        clean_after_build=["data/tools/_basic.jsonl", "data/tools/_integrated.jsonl",
                           "data/tools/_expos.jsonl", "data/tools/_transit_ALL.jsonl",
                           "data/tools/_energy.jsonl", "data/tools/_closed.jsonl",
                           "data/tools/_septic.jsonl", "data/tools/_zone.jsonl",
                           "data/tools/_complex.jsonl", "data/tools/_aptprice.jsonl"],
        # 편 원본은 적재가 끝나면 도로 치운다 — 압축본이 그대로 남아 있으므로 잃는 것이 없다
        clean_after_load=["data/exports/_load/*.csv", "data/raw/hub_seoul/*"],
        verify=[
            ("건물 58만 동 이상",
             "select count(*)>=580000, to_char(count(*),'999,999') from master.buildings"),
            ("좌표 있는 건물 90% 이상",
             "select 100.0*count(geom)/nullif(count(*),0)>=90,"
             " round(100.0*count(geom)/nullif(count(*),0),1)||'%' from master.buildings"),
            ("필지 89만 이상",
             "select count(*)>=890000, to_char(count(*),'999,999') from master.parcels"),
            # 되붙임(load_parcel_luris)이 빠지면 여기서 걸린다 — 2026-09-06 에 0건이 됐다
            ("필지 용도지역 95% 이상",
             "select 100.0*count(use_zone)/nullif(count(*),0)>=95,"
             " round(100.0*count(use_zone)/nullif(count(*),0),1)||'%' from master.parcels"),
            ("필지 법정 건폐·용적 95% 이상",
             "select 100.0*count(legal_bcr)/nullif(count(*),0)>=95,"
             " round(100.0*count(legal_bcr)/nullif(count(*),0),1)||'%' from master.parcels"),
            ("legal_bcr 가 배열일 것(0153)",
             "select data_type='ARRAY', data_type from information_schema.columns"
             " where table_schema='master' and table_name like 'parcels_v%'"
             " and column_name='legal_bcr' order by table_name desc limit 1"),
            ("건물↔필지 연결 68만 이상",
             "select count(*)>=680000, to_char(count(*),'999,999') from master.building_parcels"),
            ("표제부 원문 58만 줄 이상(AI 보유)",
             "select count(*)>=580000, to_char(count(*),'999,999') from master.building_ledger_raw"),
            ("원문에 내진·지붕·대수선구분이 살아 있을 것",
             "select count(*)>=3, string_agg(k,'·') from ("
             "  select unnest(array['내진적용','지붕','최근대수선구분']) k) z"
             " where exists (select 1 from master.building_ledger_raw r where r.rec ? z.k)"),
            ("층별개요 290만 이상",
             "select count(*)>=2900000, to_char(count(*),'999,999,999') from master.floor_outline"),
            ("도로폭 붙은 건물 45만 이상",
             "select count(*)>=450000, to_char(count(*),'999,999') from master.building_road"),
        ],
    ),
}

# ── 파생 — 읽는 것(reads)의 판이 올랐을 때만 돈다 ─────────────────────────
# 순서가 의존이다: 참조표 → 층 임대 → 건물 임대 → 적정가 → 점수. 뒤집으면 옛 값 위에서 계산한다.
DERIVES: list[dict] = [
    # area_event 를 다시 만들면 본문이 통째로 빈다 — load_urban_notice 를 반드시 뒤에 붙인다
    dict(step="area_event", label="주변 소식 합침 + 고시 본문 되붙임",
         reads=["news.notice", "news.press", "news.g2b", "news.facility", "news.permit", "news.zones"],
         run=[S(["scripts/build_area_event.py"], "app"),
              S(["scripts/load_urban_notice.py"], "app", "data/raw/_urban_notice/notices.jsonl")]),
    dict(step="building_calc", label="검색·분석 용적률·건폐율", reads=["ledger"],
         run=[S(["scripts/build_building_calc.py"], "app")]),
    dict(step="building_legal", label="법정 건폐·용적", reads=["ledger", "parcels"],
         run=[S(["scripts/build_building_legal.py"], "app")]),
    dict(step="sale_price_index", label="분기 가격지수", reads=["sales", "ledger", "gongsi"],
         verify=[("분기 25개 이상",
              "select count(*)>=25, count(*)::text||'분기' from master.sale_price_index")],
         run=[S(["scripts/rent_estimate/build_price_index.py"], "app")]),
    dict(step="floor_rent_est", label="층별 임대추정", reads=["ledger", "rent_index", "gongsi"],
         verify=[("200만 줄 이상",
              "select count(*)>=2000000, to_char(count(*),'999,999,999')"
              " from master.floor_rent_est")],
         run=[S(["scripts/rent_estimate/build_floor.py"], "app")]),
    dict(step="building_rent_est", label="건물 임대추정", reads=["ledger", "rent_index", "floor_rent_est", "gongsi"],
         verify=[("추정 있는 건물 18만 이상",
              "select count(monthly_rent)>=180000, to_char(count(monthly_rent),'999,999')"
              " from master.building_rent_est")],
         run=[S(["scripts/rent_estimate/build_bldg.py"], "app")]),
    dict(step="income_cap", label="구별 cap rate", reads=["sales", "building_rent_est"],
         verify=[("서울 25구가 다 있을 것",
              "select count(*)>=25, count(*)::text||'구' from master.income_cap")],
         run=[S(["scripts/rent_estimate/build_income_cap.py"], "app")]),
    dict(step="building_sale_est", label="적정가",
         reads=["sales", "land_adjust", "income_cap", "building_rent_est", "sale_price_index", "gongsi"],
         verify=[("적정가 15만 동 이상",
              "select count(sale_est)>=150000, to_char(count(sale_est),'999,999')"
              " from master.building_sale_est")],
         run=[S(["scripts/rent_estimate/build_sale_est.py"], "app")]),
    dict(step="building_score", label="활용유형·매도가능성",
         reads=["ledger", "sales", "gongsi", "news.zones", "building_calc", "building_sale_est", "parcels"],
         verify=[("활용유형 55만 동 이상",
              "select count(use_type)>=550000, to_char(count(use_type),'999,999')"
              " from master.building_score")],
         run=[S(["scripts/build_building_score.py"], "app")]),
]

CADENCES = ("weekly", "monthly", "quarterly", "semiannual", "yearly")
DERIVE_STEPS = {d["step"] for d in DERIVES}


def units_of(cadence: str) -> list[str]:
    return [k for k, u in UNITS.items() if u["cadence"] == cadence]


# ── 파생 검증 ───────────────────────────────────────────────────────────
# **적재가 끝났다고 맞게 들어간 것은 아니다.** 2026-09-06 에 building_legal 이 0줄로
# 만들어졌는데 파생은 「성공」으로 끝났다. 자기가 낸 결과를 아무도 안 쟀기 때문이다.
# 검사 하나 = (이름, SQL). SQL 은 **두 칸**을 낸다 — 참/거짓, 그리고 사람이 읽을 값.
DERIVE_VERIFY: dict[str, list[tuple[str, str]]] = {
    "area_event": [
        ("갈래 다섯이 다 있을 것",
         "select count(*)=5, string_agg(kind||' '||n,' · ') from ("
         "  select kind, count(*) n from master.area_event group by 1) z"),
        ("2만 줄 이상",
         "select count(*)>=20000, to_char(count(*),'999,999') from master.area_event"),
        # 원천이 주는 이름을 믿지 않는다 — 「(기구축내용없음)」 164건이 화면에 그대로 섰다
        ("이름 자리표시 0줄",
         "select count(*)=0, count(*)::text from master.area_event"
         " where name like '%기구축내용없음%' or name like '제0000-000호%'"),
        ("고시 본문 붙음 25% 이상",
         "select 100.0*count(body)/nullif(count(*),0)>=25,"
         " round(100.0*count(body)/nullif(count(*),0),1)||'%' from master.area_event"),
        # 보도자료 본문은 저장 금지(공공누리 4유형)
        ("정책 발표 줄에 본문 없을 것",
         "select count(*)=0, count(*)::text from master.area_event"
         " where kind='정책 발표' and body is not null and body<>''"),
    ],
    "building_calc": [
        ("계산 용적률 1.5만 동 이상",
         "select count(far_calc)>=15000, to_char(count(far_calc),'999,999')"
         " from master.building_calc"),
        # 대장이 본값이다 — 계산값이 대장 있는 건물을 덮으면 안 된다
        ("대장 값을 덮은 건 0건",
         "select count(*)=0, count(*)::text from master.building_calc c"
         "  join master.buildings b using (building_pk)"
         " where b.far is not null and c.far_calc is not null"),
    ],
    "building_legal": [
        ("50만 줄 이상",
         "select count(*)>=500000, to_char(count(*),'999,999') from master.building_legal"),
        ("용적 커버리지 90% 이상",
         "select 100.0*count(l.legal_far)/nullif(count(*),0)>=90,"
         " round(100.0*count(l.legal_far)/nullif(count(*),0),1)||'%'"
         " from master.buildings b left join master.building_legal l using (building_pk)"),
    ],
    "sale_price_index": [
        ("분기 25개 이상",
         "select count(*)>=25, count(*)::text||'분기' from master.sale_price_index"),
    ],
    "floor_rent_est": [
        # 실측 125만 층 · 20.4만 동(2026-09-07). 상업 매물만 추정하므로 전 건물이 아니다
        ("120만 층 이상",
         "select count(*)>=1200000, to_char(count(*),'999,999,999') from master.floor_rent_est"),
        ("건물 20만 동 이상",
         "select count(distinct building_pk)>=200000,"
         " to_char(count(distinct building_pk),'999,999') from master.floor_rent_est"),
        # 지하1층이 지하3층보다 비싸야 한다 — 층 요율이 뒤집히면 층 파싱이 깨진 것이다
        ("지하1층 요율 > 지하3층",
         "select coalesce(max(case when seq=-1 then m end) >"
         "                max(case when seq=-3 then m end), true), '층 요율 순서'"
         " from (select seq, avg(rent_est) m from master.floor_rent_est"
         "        where seq in (-1,-3) group by seq) z"),
    ],
    "building_rent_est": [
        ("추정 있는 건물 18만 이상",
         "select count(monthly_rent)>=180000, to_char(count(monthly_rent),'999,999')"
         " from master.building_rent_est"),
    ],
    "income_cap": [
        # 25구 + 구를 못 고를 때 쓰는 서울 전체 기본값 `_seoul` 한 줄 = 26
        ("25구 + 서울 기본값",
         "select count(*) filter (where gu ~ '^[0-9]+$')=25"
         " and count(*) filter (where gu='_seoul')=1,"
         " count(*)::text||'줄' from master.income_cap"),
        ("cap 이 1~6% 안에 들 것",
         "select count(*)=0, coalesce(string_agg(gu||' '||round(cap*100,2)||'%',','),'없음')"
         " from master.income_cap where cap not between 0.01 and 0.06"),
    ],
    "building_sale_est": [
        ("적정가 15만 동 이상",
         "select count(sale_est)>=150000, to_char(count(sale_est),'999,999')"
         " from master.building_sale_est"),
    ],
    "building_score": [
        ("활용유형 55만 동 이상",
         "select count(use_type)>=550000, to_char(count(use_type),'999,999')"
         " from master.building_score"),
    ],
}

for _d in DERIVES:                       # 선언을 한 곳에 모아 두고 여기서 붙인다
    _d["verify"] = DERIVE_VERIFY.get(_d["step"], [])


# ── 받은 것 확인 ────────────────────────────────────────────────────────
# **받은 날 잡아야 한다.** 2026-09-02 에 실거래 2016년이 1,006바이트 HTML 오류 페이지로
# 받아졌는데 아무도 안 재서, 나흘 뒤 적재 문턱에서야 걸렸다. 그동안 그 원본으로 빌드를 돌렸다.
# 규칙 = (이름, glob, 최소바이트, 첫 4KB 에 있어야 할 글자|None, 최소 파일 수)
CRAWL_VERIFY: dict[str, list[tuple]] = {
    "sales": [("실거래 CSV 42장 · 각 100KB 이상", "data/raw/실거래가/*.csv",
               100_000, "실거래", 40)],
    "news.notice": [("고시 jsonl 1MB 이상", "data/raw/_urban_notice/notices.jsonl",
                     1_000_000, None, 1)],
    "news.g2b": [("나라장터 json 500KB 이상", "data/raw/_g2b/bids_cnstwk.json",
                  500_000, None, 1)],
    # 작은 파일이 정상인 것들이다 — 서울에 화장장·의료폐기물세탁업은 몇 곳 없다.
    # 크기 하한은 「원천이 오류 페이지를 줬나」를 가리는 선이지 자료량을 재는 선이 아니다.
    "news.facility": [("도시계획시설 zip 4종", "data/raw/_seoul_gis/*.zip", 10_000, None, 4)],
    "stores.localdata": [("LOCALDATA 200개 이상", "data/raw/_localdata/*", 200, None, 200)],
    "stores.sbiz": [("소상공인 상가정보", "data/raw/_sbiz/*", 1_000_000, None, 1)],
    "elevator": [("승강기공단 CSV 2장 · 각 10MB 이상",
                  "data/raw/한국승강기안전공단_승강기 설치 현황_*.csv",
                  10_000_000, "건물주소", 2)],
    "gongsi": [("D150 dbf 11판 · 각 400MB 이상", "data/raw/*D150*/*.dbf", 400_000_000, None, 11),
               ("옛 공시지가 CSV 26장", "data/raw/공시지가_*년.csv", 100_000, None, 26)],
    "ledger": [("건축HUB 압축본 50장 이상", "data/raw/_archive/hub_seoul/*.tar.zst",
                5_000, None, 50)],
    "land_adjust": [("지가변동률 json", "data/raw/(연) 지역별 지가변동률.json", 10_000, None, 1)],
    "road_width": [("도로구간 SHP", "data/raw/(도로명주소)도로구간_서울/TL_SPRD_MANAGE.Seoul.shp", 1_000_000, None, 1)],
    # 로그인 페이지가 돌아오면 HTML 이다 — zip 은 PK 로 시작한다
    "living_pop": [("생활인구 zip 5장 이상 · 각 5MB", "data/raw/_living_pop/*.zip", 5_000_000, "PK", 5)],
    "trade_area": [("상권 SHP", "data/raw/서울시 상권분석서비스(영역-상권)/sanggwon.shp", 100_000, None, 1)],
    "transit": [("역사마스터 json", "data/raw/서울시 역사마스터 정보.json", 50_000, "DATA", 1),
                ("버스정류소 json", "data/raw/서울시 버스정류소 위치정보.json", 1_000_000, "DATA", 1)],
    "parcels": [("지적도 SHP", "data/raw/LSMD_CONT_LDREG_5174_서울/*.shp", 100_000_000, None, 1),
                ("용도지역 SHP", "data/raw/LSMD_CONT_UQ111_5174_서울/*.shp", 5_000_000, None, 1),
                ("토지특성 dbf 25구", "data/raw/토지특성/*/*.dbf", 1_000_000, None, 25),
                ("토지이용계획 CSV 1GB 이상", "data/raw/토지이용계획정보_서울/*.csv", 1_000_000_000, None, 1)],
}

for _k, _rules in CRAWL_VERIFY.items():
    UNITS[_k]["verify_files"] = _rules
