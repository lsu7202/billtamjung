# 앱 데이터 레이어 스키마 (초안 v0)

> **역할**: 계정·팀·크레딧·매물등록·오버레이·커뮤니티·산출물 등 **애플리케이션 데이터**의 물리 구조.
> 부동산 원천 데이터(건물·토지·공시지가)는 `schema.md`, 필드 의미는 `data-overview.md`.
> 작성 2026-07-19. 근거 결정은 `06-review/플로우점검-2026-07.md` §1·§5.

## 왜 이 문서가 생겼나
`schema.md`는 **건물·토지 물리 스키마만** 정의했다(`1행 = 건물 1동`). 계정·팀·크레딧원장·매물등록·오버레이 어느 것도 문서상 존재하지 않아, 아키텍처 착수가 불가능한 상태였다.
`mvp-scope.md`의 "크레딧 원장 스키마를 **지금 설계**" · "소유권 컬럼을 **미리** 심어둔다" 지시를 이행한다.

---

## 0. 관통 원칙

| # | 원칙 | 근거 |
|---|---|---|
| P1 | **`team_id`는 모든 사적 레이어의 NOT NULL 키.** 가입 시 1인 팀이 자동 생성되므로 팀 없는 계정이 존재하지 않는다 | 정식 팀 전환 시 **백필 불필요** (`S0M §3.5`) |
| P2 | **크레딧 잔액에 DB CHECK 제약을 걸지 않는다.** 음수 방지는 서비스 계층 게이트 | 베타=음수 허용 / 정식=차단. 전환 = **플래그 켜기**, 스키마 변경 없음 (`credit-policy §4.1`) |
| P3 | **유저 생성 데이터는 전부 soft delete**(`deleted_at`) | 복구 가능 · "만들 수는 있는데 못 지운다" 문제 일괄 해결 |
| P4 | **작성자 FK는 nullable.** 탈퇴 시 NULL 처리(익명화)하고 콘텐츠는 남긴다 | 지우면 집단지성 붕괴, 남기면 개인정보 충돌 → 익명화가 절충 |
| P5 | 시각 컬럼은 `_at` 접미사 · UTC 저장 · 금액은 **원(KRW) 정수** | `data-overview` 저장 단위 원칙 |

---

## 1. 계정 · 팀

### `accounts`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | PK | |
| `email` | TEXT UNIQUE NOT NULL | 로그인 ID |
| `password_hash` | TEXT | |
| `name` | TEXT NOT NULL | |
| `office_name` | TEXT | 중개사무소명(선택). 기본 팀명으로 사용 |
| `phone` | TEXT | **[정식]** 인증 시 채움. MVP는 NULL (`S00 §3.3.1` 강등) |
| `phone_verified_at` | TIMESTAMP | [정식] |
| `is_admin` | BOOL DEFAULT false | **운영자** — 위키·광고 신고 처리 주체 |
| `trial_started_at` / `trial_ends_at` | TIMESTAMP | 체험판 1개월 |
| `created_at` / `deleted_at` | TIMESTAMP | 탈퇴 = soft delete |

- [규칙] 가입 트랜잭션 = `accounts` INSERT → `teams` INSERT(1인팀) → `team_members` INSERT(대표) → 체험판 크레딧 지급. **원자적으로 처리.**

### `teams`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | PK | |
| `name` | TEXT NOT NULL | 기본 = `office_name` or `{name} 팀` |
| `owner_account_id` | FK accounts NOT NULL | 대표. 팀당 1명 |
| `created_at` | TIMESTAMP | |

### `team_members`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `team_id` / `account_id` | FK, **PK(team_id, account_id)** | |
| `role` | ENUM(대표/팀원) | |
| `joined_at` / `left_at` | TIMESTAMP | 제외·탈퇴 = `left_at` 기록 |

### `team_invites` [정식]
`id · team_id · invited_by · channel(phone/email) · target · token · status(대기/수락/취소/만료) · expires_at · created_at`
- [열림] 미가입자 초대 → 가입 후 자동 합류 시 **매칭 키**(전화 vs 이메일 정규화) 미정.

---

## 2. 크레딧 원장

### `credit_entries` — **append-only**
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | PK | |
| `account_id` | FK NOT NULL | 크레딧은 **개인 귀속**(팀 공유 안 함) |
| `occurred_at` | TIMESTAMP NOT NULL | |
| `type` | ENUM(지급/소비/적립/소멸/조정) | |
| `bucket` | ENUM(monthly/earned/purchased) | ↓ |
| `amount` | INT NOT NULL | 지급·적립 = +, 소비·소멸 = − |
| `reason` | TEXT | |
| `ref_type` / `ref_id` | TEXT / BIGINT | 산출물·위키 등 연결 |
| `expires_at` | TIMESTAMP | `monthly`만 채움(말일) |

**bucket이 필요한 이유**: 소멸 규칙이 유형별로 다르다.

| bucket | 소멸 | 지급 트리거 |
|---|---|---|
| `monthly` | **월말 소멸** | **달력 월초** 배치 |
| `earned` (위키 기여) | 이월 | 채택 시점 |
| `purchased` [정식] | 이월 | 결제 시점 |

- [규칙] **차감 순서 = 소멸 임박분 우선** (`monthly → earned → purchased`).
- [규칙] **잔액 = 원장 합산**(또는 materialized 캐시). **`CHECK(balance >= 0)` 금지** (P2).
- [규칙] 베타는 게이트 off → 잔액이 음수로 내려가며 그대로 기록된다. 화면 `잔액 0 · 초과 120`.
- [규칙] 정식 전환 = **게이트 on + 잔액 리셋**. 무결제 기간 잔액은 실채무가 아니다.
- [열림] `earned` 적립 트리거 — 수정이력 재정의로 "채택" 이벤트가 사라졌다(`플로우점검 T-03`).

---

## 3. 매물 등록 (선점)

### `listings`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | PK | |
| `building_pk` | TEXT NOT NULL | 건축물대장 PK = **대표지번 단위** |
| `team_id` | FK NOT NULL | |
| `assignee_account_id` | FK **NULL 허용** | **담당자. NULL = 등록 해제(선점 없음)** |
| `created_at` / `updated_at` | TIMESTAMP | |
| **업무 필드** | | 진행상태·긴급도·등급·입지·소유자타입/명/내용·관계·협조도·친절도·매수의향서·**전화번호**·매물번호·접수일 |

- **`UNIQUE(building_pk, team_id)`** — 팀당 건물 1행
- **`UNIQUE(building_pk, team_id) WHERE assignee_account_id IS NOT NULL`** ← **팀 내 배타적 선점**의 실체
- [규칙] **내 매물 판정 = `assignee_account_id IS NOT NULL`.** 레코드 유무가 아니다. **진행상태와 무관**.
- [규칙] **등록 해제 = `assignee_account_id`를 NULL로.** 레코드와 업무 데이터는 **그대로 남는다.**
  - 근거(2026-07-19): 해제는 "선점을 놓는 것"이지 "조사한 정보를 버리는 것"이 아니다. 발품으로 모은 소유자 연락처·진행상태가 해제 한 번에 사라지면 손해가 크다. 재등록 시 그대로 이어서 쓴다.
  - 업무 데이터는 `team_id` 소유이므로 팀 내에서 계속 공유된다(담당자가 바뀌어도 유지).
- [규칙] 팀원은 **자기 자신만** 담당자 지정 가능. 대표는 아무나 지정·변경(재배정).
- [규칙] **담당자 퇴사 → `assignee_account_id`를 대표로 자동 이관.** 고아 매물을 만들지 않는다.
- [규칙] **`전화번호`는 담당자 본인 + 대표만 조회.** 그 외 팀원에겐 마스킹 — 팀 전체 공유의 **예외 2곳 중 하나**.

---

## 4. 유저 오버레이 (마스터 정정)

### `overlays`
| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | PK | |
| `team_id` | FK NOT NULL | **팀 전체 공유** (개인 단위 아님) |
| `target_type` | ENUM(building/parcel) | ← **필지별 수정을 수용하는 키** |
| `target_id` | TEXT NOT NULL | building_pk 또는 PNU |
| `field` | TEXT NOT NULL FK→`ref.fields` | **레지스트리의 editable 필드만 허용**([[schema-ref]] §4). 새 필드 추가 시 스키마 변경 0(EAV) |
| `value` | TEXT | enum 필드면 유효 code 검증(트리거, [[schema-ref]] §4) |
| `updated_by` | FK accounts | |
| `updated_at` | TIMESTAMP | |

- **`UNIQUE(team_id, target_type, target_id, field)`**
- [규칙] 화면값 = **마스터 + 팀 오버레이**. 마스터는 절대 안 바뀐다.
- [규칙] 충돌 = **last-write-wins**. 잠금·승인 없음.
- [규칙] **되돌리기 = 행 삭제**(마스터 원본 복원). 필드별 `↺` / 전체 `↺` 둘 다 삭제 동작. **팀원이 만든 행도 삭제 가능**.
- [규칙] undo/redo 스택은 **DB에 두지 않는다** — 공유 데이터에서 lost update를 유발(`S02 §5.1`).
- **수정이력 분포(§4.3)** = 이 테이블을 **공공 필드에 한해 익명 집계**한 것. 별도 테이블 없음. 작성자 미표시라 탈퇴와 무관(P4).
  - [규칙] **사적 레이어(업무·메모·금액)는 분포에서 제외.**

---

## 5. 층별 임대정보

### `floor_rents`
`id · building_pk · team_id · 층 · 호실 · 용도 · 전용면적 · 계약면적 · 보증금 · 임대료 · 관리비 · 공실상태 · created_at · deleted_at`

- **레이어 = ② 사적(팀 소유).** 다른 팀 입력이 내 표에 섞이지 않는다. **병합·다수결 없음.**
- **단 S03 주변시세는 반경 내 전 팀의 행을 읽어 comps로 나열**한다(원본 그대로, 정제는 소비 시점).
- [규칙] 공실 호실은 **보증금·임대료·관리비가 모두 0**.
- [규칙] 프리필(층·용도·전용면적)과 수기 편집의 매칭 키 = **(building_pk, team_id, 층, 호실)**.
- [규칙] **내 매물이 아닌 건물에도 입력할 수 있다**(2026-07-19 확정). `listings` FK를 두지 않고 `building_pk + team_id`로 붙는 이유다.
  → 남의 건물 임대 조건을 알게 됐을 때 적어둘 수 있어야 S03 comps가 축적된다. 메모(§7)도 동일.

---

## 6. 커뮤니티 (③ 전체 공유)

### `wiki_posts`
`id · building_pk · author_account_id(**nullable**) · category · body · created_at · deleted_at`
- [규칙] 탈퇴 시 `author_account_id` → NULL, 표시는 "탈퇴한 사용자". 글은 남는다(P4).
- [규칙] 삭제 권한 = **작성자 본인 + 관리자**(`is_admin`).

### `wiki_votes`
`post_id · account_id · created_at` — **PK(post_id, account_id)** = 1인 1회. 취소 = **행 삭제(hard)**.
- ※ P3(soft delete) 예외. 투표는 콘텐츠가 아니라 상태라 이력을 남길 이유가 없다.

### `wiki_reports`
`id · post_id · reporter_account_id · reason · status(대기/처리/기각) · handled_by · handled_at`
- 처리 주체 = `accounts.is_admin`. 백오피스 화면은 [정식].

### `ad_prices` — 광고가 시계열
`id · building_pk · observed_on · price · is_mine · reporter_account_id(nullable) · created_at · deleted_at`
- [규칙] **`price` NULL = "광고없음" 관측** → **광고 해제**가 시계열의 새 점으로 표현된다(구조 변경 불필요).
- [규칙] **대표값 = 최신 관측 우선.** 같은 시점에 값이 여럿이면 다수결.
- [규칙] 광고 상태(광고중/광고없음)는 이 시계열에서 **파생**. `listings`와 무관 — 광고 매물 ≠ 내 매물.

---

## 7. 산출물 · 개인 데이터

### `reports` — 보고서 산출물 + 비동기 잡
| 컬럼 | 비고 |
|---|---|
| `id` · `account_id` · `building_pk` | **개인 귀속** — 만든 사람 것. 팀 공유 안 함 |
| `kind` | ENUM(브리핑/분석) — 크레딧 10 / 30 |
| `status` | ENUM(대기/생성중/완료/실패) ← **비동기 잡 상태** |
| `parent_id` | FK reports — **재생성 시 원본 연결.** 덮어쓰지 않고 새 레코드 |
| `credits_spent` · `file_path` · `options_json` | 생성 시점 옵션(상권·주변임대시세 토글) 스냅샷 |
| `source_watermark` | TIMESTAMP — **생성 시점 입력 데이터의 최신 수정 시각** ↓ |
| `master_version` | TEXT — 생성 시점 공공 마스터 데이터 버전(연 1회 공시지가 갱신 등) |
| `created_at` · `completed_at` · `failed_reason` | |

- [규칙] **재생성 = 새 레코드**(불변 이력). 이전 산출물은 그대로 보관.

#### ★ 신선도 판정 — 재다운로드 vs 재생성 *(확정 2026-07-19)*
| 상태 | 조건 | 동작 |
|---|---|---|
| **최신** | `source_watermark` = 현재 워터마크 **and** `master_version` 동일 | **재다운로드**(기존 파일, 크레딧 0) |
| **오래됨** | 둘 중 하나라도 다름 | **재생성 필요** 표시 → 새로 만들면 크레딧 재소모 |

- **워터마크 = `max(updated_at)`** of: 그 건물에 대한 **팀 오버레이 · 층별임대 · `listings` 업무값** (+ S03 curation 상태).
- **`master_version`**은 공공 데이터 적재 버전. 공시지가 연 1회 갱신 등으로 바뀌면 기존 보고서는 전부 "오래됨"이 된다 — **의도된 동작**(보고서가 옛 공시지가를 담고 있으므로).
- [규칙] 판정은 **인덱스 조회 한 번**으로 끝난다. 입력 전체를 해싱하면 정밀하지만 목록 화면마다 보고서 입력을 재조립해야 해서 비싸다.
- [규칙] 오래된 산출물도 **삭제하지 않는다.** 과거 시점 자료로서 가치가 있고, 다운로드도 계속 가능하다(다만 "생성일 기준" 고지).
- [규칙] 크레딧 차감 = **생성 성공 시**. 실패 시 미차감.
- [규칙] 사용자는 화면에서 대기(로딩) → 완료 시 자동 다운로드. **별도 알림 시스템 불필요** — 이탈해도 `내 산출물`에 남는다.
- [규칙] **`내 산출물 저장` 버튼 없음.** 레코드는 생성 요청 시점에 만들어지므로 **자동 보관**된다. 모달을 닫아도 잃지 않는다(크레딧을 쓰고 저장을 놓치는 사고 원천 차단).
- [규칙] **팀 공유 권한을 설계하지 않는다**(2026-07-19). 산출물은 결국 **PPT 파일 다운로드**이므로, 공유가 필요하면 파일을 전달하면 된다. 권한 모델을 얹는 것이 오히려 복잡하다.

### `favorites` — 즐겨찾기
`account_id · building_pk · created_at` — **PK(account_id, building_pk)**
- **개인 전용**(팀 공유 X). 내 매물과 별개.

### `saved_searches` — 저장한 검색조건
`id · account_id · name · conditions_json · created_at`

### `memos`
`id · building_pk · team_id · kind(team/secret) · body · author_account_id(nullable) · created_at · deleted_at`
- `kind=secret` = **비밀메모** → 담당자 본인 + 대표만. 팀 전체 공유의 **예외 2곳 중 나머지 하나**.
- [규칙] **내 매물이 아닌 건물에도 메모 가능**(`listings` FK 없음, `building_pk + team_id`로 붙음).
- [규칙] 담당자 재배정 시 비밀메모는 **매물에 귀속되어 승계**(사람에 귀속 아님).
- [규칙] 비밀메모는 **수정이력 분포·보고서 산출물에 절대 포함하지 않는다.**

---

## 8. 열린 항목

- 초대 매칭 키(전화/이메일 정규화 규칙) · 초대 만료 기간
- `earned` 크레딧 적립 트리거 (수정이력 재정의 여파, `T-03`)
- 대표 본인의 탈퇴·팀 삭제 시 처리 (현재 "대표는 팀을 떠날 수 없다"로 회피)
- 산출물 파일 스토리지 위치·보존기간
- 오버레이 값의 타입 — 현재 TEXT 단일. 숫자/날짜 검증을 어디서 할지
- 복수 팀 소속 허용 여부

---

*초안 v0 · 2026-07-19 · 근거 = `06-review/플로우점검-2026-07.md`*
