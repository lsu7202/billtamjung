# raw 사용 원장 (파이프라인 입력 vs 미사용)

> `data/raw` 각 항목이 **실제로 파이프라인 코드에 소비되는지** 전수 감사(2026-08-02).
> 목적: 크롤러↔파이프라인 정합 확인 + 다운만 받고 안 쓰는 노이즈 식별.
> 방법: `data/tools`·`pipeline`·`scripts`·`backend/app`의 파일 접근 리터럴·glob 전수 대조.

## A. 사용됨 + 크롤러 자동화 완료 ✅
| raw 항목 | 소비처(대표) | 크롤러 |
|---|---|---|
| `실거래가/*_매매_서울_*.csv` | build_sales · search.py | `download_rtms.sh` |
| `seoul/mart_djy_{02,03,04,05}_seoul.txt` | build_building_master·floor_outline·annex | `download_hub.py`(djy) → activate 서울추출 |
| `mart_kcy_01.txt`(전국) | build_building_master · build_daesuseon | `download_hub.py`(kcy_01=기본개요) |
| `서울시 역사마스터 정보.json`·`서울시 버스정류소 위치정보.json` | build_transit | `download_transit.py` |
| `LSMD_CONT_LDREG_5174_서울/`(지적도) | export_seoul·parcels·spatial_join·regulations·road_frontage·transit | `download_vworld.py`(30564) |
| `LSMD_CONT_UD801_서울/`(개발제한) | spatial_join | `download_vworld.py`(30261) |
| `LSMD_CONT_UQ111_5174_서울/`(용도지역) | build_land_master·spatial_join | `download_vworld.py`(30300) |
| 규제 SHP `UQ121·UQ123·UQ124·UD602·UD603·UO301` | build_regulations | `download_vworld.py`(각 dsId) |
| `토지특성/AL_D194_*/`(25구) | build_land_master·building_master | `download_vworld.py --na`(4) |
| `AL_D150_*`(공시지가 2016~) | build_land_master(series) | `download_vworld.py --na`(6) |
| `한국승강기...csv` | build_building_master(승강기) | `download_datagokr.py` |
| `상권구획도(업로드용)/` | load_sanggwon·build_bldg·series | `load_sanggwon.py` |
| `2026년 N분기...임대동향...xlsx` | rent_common(임대추정) | `download_rone.py` |

## B. 사용됨 — 크롤러 상태 (2026-08-02 재조사 후)
| raw 항목 | 소비처 | 상태 |
|---|---|---|
| `(연) 지역별 지가변동률.json` | build_land_adjust · backend buildings.py · use_type | ✅ **`download_jiga.py`**(R-ONE `sttsDataPreviewList.do` A_2024_00902 → 그리드 변환). 기존 raw와 값 완전일치 검증. |
| `C_UQ161/`(지구단위계획 SHP) | build_regulations | ✅ V-World **dsId 30115**(MK) → `download_vworld.py --misc`(fileNo 최대=SHP본 `C_UQ161.zip`). activate가 `data/raw/C_UQ161/`로 해제. 엔드투엔드 검증. |
| `공시지가_1990~2015.csv`(26개) | backfill_gongsi_pre2015 | **일회성 백필**(이미 gongsi_series 반영). 재크롤 불필요 → 백업본 유지. |

**정정**: `지역별 전월세 전환율_*.xlsx`는 **미사용**(C절로 이동). rent_common의 "전월세" 언급은 전부 주석(개념 설명)이고 실제 read 없음.

## C. 미사용 ❌ (다운만, 파이프라인 미참조 — 정리 대상)
- `(연) 용도지역별/이용상황별 지가변동률.json` — 지역별만 사용, 나머지 2종 미사용
- `지역별 전월세 전환율_*.xlsx`(4) — rent_common은 주석 언급만, 실제 read 없음(미사용 확정)
- `서울시 상권분석서비스(영역-상권)/` — 상권구획도로 대체됨
- `한반도90m_GRS80.img`(DEM 경사도) — slope 사업화 후 보류
- `LART_LMISZONE.csv` · `국가중점데이터_컬럼정의서.xlsx` · `260724...지가상승...pdf`(참고문서)
- 추가 LSMD 중복/미사용: `LSMD_CONT_LDREG_서울`(non-5174)·`UQ111_서울`(non-5174 중복)·`UB901`·`UM720`·`UQ101_5174`
- 미소비 mart: `mart_djy_01·09`, `mart_kcy_02·04·05·10·11·12·13·15`(+ 각 `_seoul` 추출본)
- `서울교통공사_노선별 지하철역 정보.json` — build_transit는 역사마스터 사용, 이 파일은 보조/미참조(재확인)

---
**결론**: 파이프라인 실입력 **전부 크롤러 커버**(지가변동률·C_UQ161 포함). 유일한 비크롤 입력 = 공시지가 1990~2015 일회성 백필(보존). 미사용(C)은 raw 초기화 테스트 시 재크롤 불필요(백업만).
