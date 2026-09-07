/* S01b 필터 config — 목업 S01b.html GROUPS 정본 이식. */
import type { AttrFilters } from "../../shared/api/endpoints";

export type Ctl = "slider" | "ms" | "group" | "top" | "segmulti" | "text" | "pair";

/** 두 갈래 슬라이더의 한 갈래. 값의 출처가 갈리는 항목에 쓴다(2026-08-27).
 *  추정 계열은 어디서나 연파랑, 팀이 적은 값은 흰 바탕이다 — 낱말을 안 늘리고 눈으로 가른다. */
export interface Lane {
  key: string;        // 직렬화 키 접두(est · team · real)
  name: string;       // 화면 이름
  tone: "est" | "team";
  hint?: string;      // 갈래 끝에 서는 모수. 「내 매물 8」처럼 고르기 전에 보인다
}
export interface Field {
  label: string;
  ctl: Ctl;
  // slider
  min?: number; max?: number; step?: number; unit?: string;
  inf?: boolean; inflo?: boolean; handle?: "dual" | "left" | "right";
  ge?: string; le?: string; ticks?: string; chips?: [string, number | "", number | ""][];
  // ms
  opts?: string[]; dd?: boolean;
  // group — 계열로 접는다. presets 는 계열을 가로지르는 빠른선택(디벨롭 등)
  series?: { name: string; items: string[] }[];
  presets?: { name: string; items: string[] }[];
  // top — 계열이 없고 몇 개에 쏠린 것. 자주 쓰는 것만 펴고 나머지는 접는다
  top?: string[]; rest?: string[];
  // text
  ph?: string; tchips?: string[];
  // pair — 같은 지표를 값 출처별로 나란히
  lanes?: Lane[];
}
export interface Group { t: string; reps: Field[]; body: Field[] }

const S = (label: string, o: Partial<Field> = {}): Field => ({ label, ctl: "slider", ...o });
const M = (label: string, opts: string[]): Field => ({ label, ctl: "ms", opts });
/** 계열 — 묶음을 먼저 고르고 그 안에서 낱개. presets 는 계열을 가로지르는 빠른선택. */
const G = (label: string, series: Field["series"], presets?: Field["presets"]): Field =>
  ({ label, ctl: "group", series, presets });
/** 자주 — 상위 몇 개가 거의 다 덮는 항목. 나머지는 「＋ N개」로 접는다. */
const TOP = (label: string, top: string[], rest: string[]): Field =>
  ({ label, ctl: "top", top, rest });
const SM = (label: string, opts: string[]): Field => ({ label, ctl: "segmulti", opts });
const X = (label: string, ph: string, tchips?: string[]): Field => ({ label, ctl: "text", ph, tchips });
/** 두 갈래 — 위가 추정(연파랑), 아래가 팀이 적은 값(흰). 처음 손이 가는 자리가 위다. */
const P = (label: string, lanes: Lane[], o: Partial<Field> = {}): Field =>
  ({ label, ctl: "pair", lanes, ...o });

// 서울에 실제로 있는 값만 둔다(2026-08-27 실측). 예전 목록엔 「관리지역·농림·자연환경보전」
// 처럼 서울에 한 건도 없는 값과, 「전용주거·일반주거」처럼 매핑이 비어 조건이 통째로
// 사라지던 값이 섞여 있었다. 고를 수 있는데 아무 일도 안 일어나는 항목은 두지 않는다.
//
// 계열로 접는다(2026-08-27) — 칩 열여섯을 한 줄에 늘어놓으면 화면을 덮는다.
// 계열을 먼저 펴고 그 안에서 낱개를 고른다. 상업 매물 중개인이 실제로 쓰는 건 상업과 준주거다.
const 용도지역계열 = [
  { name: "상업", items: ["중심상업", "일반상업", "근린상업", "유통상업"] },
  { name: "주거", items: ["준주거", "제3종일반주거", "제2종일반주거", "제1종일반주거", "일반주거", "주거", "제2종전용주거", "제1종전용주거"] },
  { name: "공업", items: ["준공업"] },
  { name: "녹지", items: ["자연녹지", "생산녹지", "보전녹지"] },
];
// 도로접면 — 폭이 곧 계열이다(광대 > 중소로 > 세로 > 맹지)
const 도로계열 = [
  { name: "광대", items: ["광대로한면", "광대소각", "광대세각"] },
  { name: "중소로", items: ["중로한면", "중로각지", "소로한면", "소로각지"] },
  { name: "세로", items: ["세로한면(가)", "세로각지(가)", "세로한면(불)", "세로각지(불)"] },
  { name: "맹지", items: ["맹지"] },
];
// 주용도 — 계열이 없는 대신 다섯이 95%를 덮는다(2026-08-27 실측)
const 주용도자주 = ["단독주택", "공동주택", "제2종근린생활시설", "제1종근린생활시설", "업무시설"];
// 지목 — 「대」 하나가 92.8%다. 상위 셋이 98.4%
const 지목자주 = ["대", "도로", "임야"];
const 지목 = ["전", "답", "과수원", "임야", "대", "공장용지", "학교용지", "주차장", "주유소용지", "창고용지", "도로", "철도용지", "제방", "하천", "구거", "유지", "수도용지", "공원", "체육용지", "유원지", "종교용지", "사적지", "묘지", "잡종지"];
const 이용상황섹터 = [
  { name: "상업용 빌딩", items: ["상업용", "업무용", "상업기타"] },
  { name: "상가주택", items: ["주상용", "주상기타"] },
  { name: "주거", items: ["단독", "연립", "다세대", "아파트", "주거기타"] },
  { name: "공업·산업", items: ["공업용", "공업기타"] },
  { name: "신축부지", items: ["주거나지", "상업나지", "주상나지", "공업나지", "주차장등"] },
  { name: "특수·기타시설", items: ["전", "과수원", "전기타", "전창고", "전축사", "답기타", "답창고", "조림", "자연림", "토지임야", "임야기타", "골프장 회원제", "여객자동차터미널", "콘도미니엄", "공항", "고속도로휴게소", "발전소", "물류터미널", "특수기타", "도로등", "하천등", "공원등", "운동장등", "위험시설", "유해.혐오시설", "기타"] },
];
const 디벨롭 = ["단독", "연립", "다세대", "주거기타", "공업용", "공업기타", "상업용", "업무용", "상업기타", "주상용", "주상기타"];
const 형상 = ["정방형", "가로장방", "세로장방", "사다리형", "부정형", "자루형"];
const 주용도주 = ["단독주택", "다가구주택", "공동주택", "제1종근린생활시설", "제2종근린생활시설", "판매시설", "의료시설", "교육연구시설", "노유자시설", "운동시설", "업무시설", "숙박시설", "위락시설", "공장", "창고시설", "자동차관련시설"];
const 주용도부 = ["문화및집회시설", "종교시설", "운수시설", "수련시설", "위험물저장및처리시설", "동물및식물관련시설", "자원순환관련시설", "교정및군사시설", "국방,군사시설", "방송통신시설", "발전시설", "묘지관련시설", "관광휴게시설", "장례시설", "야영장시설", "분뇨.쓰레기처리시설", "가설건축물", "근린생활시설", "판매및영업시설", "교육연구및복지시설", "공공용시설"];

export const GROUPS: Group[] = [
  { t: "입지",
    reps: [S("역과의거리", { min: 0, max: 1000, unit: "m", inf: true, handle: "right", ticks: "0,500", le: "이내", chips: [["도보5분↓", 0, 350], ["도보10분↓", 0, 700]] })],
    // 실측이므로 명수로 고른다. 「매우높음」 다섯 칸은 우리가 정한 분위라 무엇을 고르는지 알 수 없었다.
    body: [S("유동인구", { min: 0, max: 5000, unit: "명", inf: true, ticks: "0,1500,3000",
      chips: [["번화가", 3000, ""], ["한적", "", 500]] })] },
  { t: "건물",
    reps: [
      S("대지면적", { min: 0, max: 300, unit: "평", inf: true, ticks: "0,100,200" }),
      S("연면적", { min: 0, max: 500, unit: "평", inf: true, ticks: "0,150,300" }),
      S("건축면적", { min: 0, max: 200, unit: "평", inf: true, ticks: "0,50,100" }),
      S("엘리베이터", { min: 0, max: 6, unit: "대", inf: true, handle: "left", ticks: "0,2,4" }),
      S("주차", { min: 0, max: 20, unit: "대", inf: true, handle: "left", ticks: "0,5,10" }),
      S("사용승인일", { min: 0, max: 30, unit: "년", inf: true, ticks: "0,10,20", ge: "이상", le: "이하", chips: [["신축 5년↓", 0, 5], ["준신축 10년↓", 0, 10], ["구옥 20년↑", 20, ""]] }),
    ],
    body: [
      S("용적산정 연면적", { min: 0, max: 500, unit: "평", inf: true, ticks: "0,150,300" }),
      S("건폐율", { min: 0, max: 100, unit: "%", inf: true, ticks: "0,50,60,80" }),
      S("법정 건폐율", { min: 0, max: 100, unit: "%", inf: true, ticks: "0,50,60,80" }),
      S("용적률", { min: 0, max: 1000, unit: "%", inf: true, ticks: "0,300,600" }),
      S("법정 용적률", { min: 0, max: 1000, unit: "%", inf: true, ticks: "0,300,600" }),
      S("건폐율 여유분", { min: 0, max: 100, unit: "%", inf: true, handle: "left", ticks: "0,20,40", chips: [["여유 10%↑", 10, ""], ["여유 20%↑", 20, ""]] }),
      S("용적률 여유분", { min: 0, max: 500, unit: "%", inf: true, handle: "left", ticks: "0,100,200", chips: [["여유 100%↑", 100, ""], ["여유 200%↑", 200, ""]] }),
      S("지상 층수", { min: 0, max: 30, unit: "층", inf: true, handle: "left", ticks: "0,10,20" }),
      S("지하 층수", { min: 0, max: 10, unit: "층", inf: true, handle: "left", ticks: "0,3,6" }),
      S("대수선 및 리모델링 경과", { min: 0, max: 30, unit: "년", inf: true, handle: "right", le: "이하", ticks: "0,10,20" }),
      TOP("주용도", 주용도자주, [...주용도주, ...주용도부].filter((x) => !주용도자주.includes(x))),
      X("기타용도", "건축물대장 기타용도 · 부분일치", ["근린생활시설", "사무소", "업무시설", "단독주택", "다가구주택", "소매점", "판매시설", "상가"]),
    ] },
  { t: "토지",
    reps: [G("용도지역", 용도지역계열)],
    body: [
      S("토지면적", { min: 0, max: 300, unit: "평", inf: true, ticks: "0,100,200" }),
      TOP("지목", 지목자주, 지목.filter((x) => !지목자주.includes(x))),
      G("토지이용상황", 이용상황섹터, [{ name: "디벨롭", items: 디벨롭 }]),
      M("지형/형상", 형상), G("도로접면", 도로계열),
      M("지세", ["저지", "평지", "완경사", "급경사", "고지"]),
      // 공시지가는 땅값이라 토지에 산다
      S("최신 공시지가", { min: 0, max: 5000, unit: "만원/㎡", inf: true, ticks: "0,1000,3000" }),
      S("공시지가 상승률 5년", { min: 0, max: 100, unit: "%", inf: true, handle: "left", ticks: "0,30,60" }),
      S("공시지가 상승률 10년", { min: 0, max: 200, unit: "%", inf: true, handle: "left", ticks: "0,50,100" }),
      S("공시지가 기준", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100,150" }),
    ] },
  { t: "금액",
    // 값의 출처가 갈리는 항목은 **두 갈래**로 세운다(2026-08-27). 위가 추정, 아래가 팀이 적은 값.
    // 처음 쓰는 사람은 익숙한 「매매가」를 고르는데, 담은 매물이 없으면 0건이 나와 필터가
    // 고장난 것으로 읽혔다. 위에 추정가를 두고 아래 갈래에 모수를 적어 그 일을 막는다.
    //
    // 임대료·보증금도 같은 문법이다(2026-08-28) — 추정이 20.1만동에 있는데 필터로는 못 찾았다.
    reps: [
      P("금액", [
        { key: "est", name: "추정가", tone: "est" },
        { key: "team", name: "매매가", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100,150",
           chips: [["~50억", 0, 50], ["50~100", 50, 100], ["100억~", 100, ""]] }),
      P("수익률", [
        { key: "est", name: "추정", tone: "est" },
        { key: "team", name: "실제", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 8, step: 0.1, unit: "%", inf: true, handle: "left", ticks: "0,2,4,6",
           chips: [["3%↑", 3, ""], ["4%↑", 4, ""], ["5%↑", 5, ""]] }),
      P("임대료", [
        { key: "est", name: "추정", tone: "est" },
        { key: "team", name: "실제", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 10000, unit: "만원", inf: true, ticks: "0,2000,5000",
           chips: [["1,000만↑", 1000, ""], ["3,000만↑", 3000, ""], ["5,000만↑", 5000, ""]] }),
      S("실거래가", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100" }),
    ],
    body: [
      P("보증금", [
        { key: "est", name: "추정", tone: "est" },
        { key: "team", name: "실제", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 100000, unit: "만원", inf: true, ticks: "0,10000,30000,50000" }),
      P("대지 평단가", [
        { key: "est", name: "추정가", tone: "est" },
        { key: "team", name: "매매가", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 30000, unit: "만원", inf: true, ticks: "0,5000,10000,20000" }),
      P("연면적 평단가", [
        { key: "est", name: "추정가", tone: "est" },
        { key: "team", name: "매매가", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 15000, unit: "만원", inf: true, ticks: "0,3000,6000,10000" }),
      P("공시총액 비율", [
        { key: "est", name: "추정가", tone: "est" },
        { key: "team", name: "매매가", tone: "team", hint: "내 매물" },
      ], { min: 0, max: 200, unit: "%", inf: true, ticks: "0,50,100" }),
      S("관리비", { min: 0, max: 5000, unit: "만원", inf: true, ticks: "0,1000,3000" }),
      S("수익률(공실제외)", { min: 0, max: 8, step: 0.1, unit: "%", inf: true, handle: "left", ticks: "0,3,6" }),
      SM("공실", ["있음", "없음"]),
      S("실거래일", { min: 0, max: 30, unit: "년", inf: true, ticks: "0,10,20", ge: "이상", le: "이내", chips: [["최근 5년↓", 0, 5], ["최근 10년↓", 0, 10], ["10년↑ 미거래", 10, ""]] }),
      S("실거래손익", { min: -50, max: 200, unit: "%", inf: true, inflo: true, ticks: "-50,0,50,100" }),
      S("실거래횟수", { min: 0, max: 10, unit: "건", inf: true, handle: "left", ticks: "0,3,6" }),
    ] },
  { t: "매물",
    // 「건물용도(수익률·신축용·사옥용·리모델링용)」를 뺐다(2026-08-27). 우리가 추측한 값이고,
    // 같은 개념을 배치 점수(building_score.use_type)가 또 만들어 이름이 둘로 갈려 있었다.
    // 건축물대장 용어인 주용도·기타용도가 용도의 정본이다.
    //
    // 「등급」·「입지」도 뺐다 — 업무 탭 매물 모달이 그 칸을 안 쓴다(쓰는 건 매수자 등급뿐).
    // 화면에 없는 값을 검색으로 거르면 늘 0건이다.
    // 소유자 조건도 여기 합쳤다: 매물 하나에 소유자 하나(0058)라 묶음을 가를 이유가 없다.
    reps: [
      // 「상태」 칩은 뺐다(0142) — 매물에 상태 칸이 없어졌다. 지금 어디까지 왔나는
      // 사실에서 파생하므로(v_listing_stage · nego_rank) 거를 값이 아니다.
      M("긴급도", ["매우급함", "급함", "보통", "여유"]),
    ],
    body: [
      M("담당자", []),                                 // 런타임 팀멤버 주입(FilterModal). 하드코딩 금지
      M("명도", ["확인중", "완료", "가능", "불가", "일부", "조건부"]),
      M("용도변경", ["확인중", "나대지(주차장)", "근생", "상가주택", "다가구주택", "다세대주택", "가능", "불가", "협의가능", "조건부"]),
      M("멸실", ["확인중", "불가", "협조가능", "잔금전멸실", "나대지(주차장)", "협의가능", "조건부"]),
      M("소유자타입", ["개인", "법인"]),
      M("관계", ["건물주/법인대표", "관리자", "친인척", "부동산", "기타"]),
      M("협조도", ["협조적", "보통", "비협조적"]), M("친절도", ["친절", "보통", "불친절"]),
      X("소유자명", "소유자명"), X("매물번호", "매물번호"),
      S("접수일", { min: 1970, max: 2026, unit: "", inf: true, inflo: true, ge: "부터", le: "까지", ticks: "2000,2015" }),
      SM("매수의향서", ["원함", "검토"]), SM("전화번호", ["있음", "없음"]),
      SM("사진", ["있음", "없음"]),
    ] },
];

/** 서버가 받는 조건 칸 이름 전부(backend Filters). 저장된 옛 조건을 되살릴 때 쓴다.
 *
 *  서버는 extra=forbid 다 — 모르는 칸이 하나라도 오면 검색 전체가 422 로 죽는다. 오타를
 *  조용히 삼키지 않으려고 그렇게 뒀는데, 조건을 **저장해 두는 기능** 때문에 부작용이 생겼다.
 *  2026-08-27 에 등급·입지·건물용도 필터를, 08-28 에 유동인구 등급 칸을 없앴더니, 그 전에
 *  저장해 둔 조건·매수자 조건이 죽은 칸을 그대로 들고 있다가 불러오는 순간 검색을 통째로
 *  죽였다. 저장 조건은 「지난 판으로 적은 글」이라 옛 낱말이 섞이는 게 정상이다.
 *  그래서 **되살릴 때만** 모르는 칸을 떨군다. 새로 거는 조건은 그대로 서버로 보내 422 로
 *  드러나게 둔다 — 오타를 잡아내던 그물은 남긴다. */
const SERVER_FILTER_KEYS = new Set([
  "bjd_code", "building_pk", "use_zones", "jimoks", "road_frontages", "shapes", "slopes",
  "land_uses", "main_uses", "etc_use", "land_area_min", "land_area_max", "total_area_min",
  "total_area_max", "build_area_min", "build_area_max", "floors_above_min", "floors_above_max",
  "floors_below_min", "floors_below_max", "bcr_min", "bcr_max", "far_min", "far_max",
  "elevator_min", "elevator_max", "parking_min", "parking_max", "station_dist_max",
  "last_sale_min", "last_sale_max", "last_sale_years_min", "last_sale_years_max",
  "gongsi_min", "gongsi_max", "age_min", "age_max", "parcel_area_min", "parcel_area_max",
  "far_area_min", "far_area_max", "remodel_years_min", "remodel_years_max",
  "legal_bcr_min", "legal_bcr_max", "legal_far_min", "legal_far_max",
  "bcr_slack_min", "bcr_slack_max", "far_slack_min", "far_slack_max",
  "price_min", "price_max", "sale_est_min", "sale_est_max", "roi_est_min", "roi_est_max",
  "rent_est_min", "rent_est_max", "deposit_est_min", "deposit_est_max",
  "pp_land_team_min", "pp_land_team_max", "pp_total_team_min", "pp_total_team_max",
  "gongsi_ratio_team_min", "gongsi_ratio_team_max", "roi_min", "roi_max",
  "roi_exvac_min", "roi_exvac_max", "pp_land_min", "pp_land_max", "pp_total_min", "pp_total_max",
  "deposit_total_min", "deposit_total_max", "rent_total_min", "rent_total_max",
  "mgmt_total_min", "mgmt_total_max", "vacant", "gongsi_total_min", "gongsi_total_max",
  "gongsi_ratio_min", "gongsi_ratio_max", "gongsi_up5_min", "gongsi_up5_max",
  "gongsi_up10_min", "gongsi_up10_max", "sale_pnl_min", "sale_pnl_max",
  "sale_count_min", "sale_count_max", "pop_day_min", "pop_day_max",
  "urgencies", "owner_types", "relations", "cooperations", "kindnesses",
  "meongdos", "use_changes", "myeolsils", "assignees", "owner_name", "listing_no",
  "intent", "has_phone", "has_photo", "received_from", "received_to",
]);

/** 저장해 둔 조건에서 지금 판에 없는 칸을 떨군다. */
/** 서버 조건 칸 이름 → 사람 말. **`values` 없이 `filters` 만 저장된 조건**을 위한 것이다.
 *
 *  매수자 조건은 `values`(화면 낱말)와 `filters`(서버 조건)를 나란히 저장하는데,
 *  옛 조건 중엔 `filters` 만 든 것이 있다. 그런 조건을 불러오면 **검색은 걸리는데
 *  화면에 아무 표시가 없어** 「안 걸렸다」로 읽힌다(2026-09-05 지적).
 *  걸린 것은 무엇이든 칩으로 세운다 — 조용히 거르지 않는다. */
const FILTER_NAME: Record<string, string> = {
  price: "매매가", sale_est: "추정가", roi: "수익률", roi_est: "추정 수익률",
  rent_est: "추정 임대료", deposit_est: "추정 보증금", rent_total: "총 월 임대료",
  deposit_total: "총 월 보증금", mgmt_total: "총 월 관리비",
  land_area: "대지면적", total_area: "연면적", build_area: "건축면적", parcel_area: "필지면적",
  floors_above: "지상층", floors_below: "지하층", bcr: "건폐율", far: "용적률",
  legal_bcr: "법정 건폐율", legal_far: "법정 용적률",
  elevator: "엘리베이터", parking: "주차", age: "연식", station_dist: "역과의 거리",
  gongsi: "공시지가", gongsi_total: "공시 총액", last_sale_years: "최근 거래",
  remodel_years: "대수선", pp_land: "대지 평단가", pp_total: "연면적 평단가",
};
const UNIT: Record<string, (v: number) => string> = {
  price: (v) => `${Math.round(v / 1e8).toLocaleString()}억`,
  sale_est: (v) => `${Math.round(v / 1e8).toLocaleString()}억`,
  station_dist: (v) => `${v}m`,
};

/** `filters` 만 든 조건을 칩으로. `values` 로 이미 보이는 것은 부르는 쪽이 거른다. */
export function filterChips(f: AttrFilters | undefined): { label: string; text: string }[] {
  if (!f) return [];
  const g: Record<string, { lo?: number; hi?: number }> = {};
  for (const [k, v] of Object.entries(f)) {
    const m = /^(.+)_(min|max)$/.exec(k);
    if (!m || typeof v !== "number" || !FILTER_NAME[m[1]]) continue;
    (g[m[1]] ??= {})[m[2] === "min" ? "lo" : "hi"] = v;
  }
  const fmt = (base: string, v: number) => (UNIT[base] ?? ((x: number) => x.toLocaleString()))(v);
  return Object.entries(g).map(([base, r]) => ({
    label: FILTER_NAME[base],
    text: r.lo != null && r.hi != null ? `${fmt(base, r.lo)}~${fmt(base, r.hi)}`
      : r.lo != null ? `${fmt(base, r.lo)} 이상` : `${fmt(base, r.hi!)} 이하`,
  }));
}

export function pruneFilters(f: unknown): AttrFilters {
  if (!f || typeof f !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f as Record<string, unknown>))
    if (SERVER_FILTER_KEYS.has(k)) out[k] = v;
  return out as AttrFilters;
}
