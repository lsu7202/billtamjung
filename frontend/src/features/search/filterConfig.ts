/* S01b 필터 config — 목업 S01b.html GROUPS 정본 이식. */

export type Ctl = "slider" | "ms" | "sector" | "tier" | "segmulti" | "text";
export interface Field {
  label: string;
  ctl: Ctl;
  // slider
  min?: number; max?: number; step?: number; unit?: string;
  inf?: boolean; inflo?: boolean; handle?: "dual" | "left" | "right";
  ge?: string; le?: string; ticks?: string; chips?: [string, number | "", number | ""][];
  // ms
  opts?: string[]; dd?: boolean;
  // sector
  sectors?: { name: string; items: string[] }[]; presets?: { name: string; items: string[] }[];
  // tier
  groups?: { name: string; open?: boolean; items: string[] }[];
  // text
  ph?: string; tchips?: string[];
}
export interface Group { t: string; reps: Field[]; body: Field[] }

const S = (label: string, o: Partial<Field> = {}): Field => ({ label, ctl: "slider", ...o });
const M = (label: string, opts: string[]): Field => ({ label, ctl: "ms", opts });
const MD = (label: string, opts: string[]): Field => ({ label, ctl: "ms", opts, dd: true });
const GRP = (label: string, sectors: Field["sectors"], presets: Field["presets"]): Field => ({ label, ctl: "sector", sectors, presets });
const TM = (label: string, groups: Field["groups"]): Field => ({ label, ctl: "tier", groups });
const SM = (label: string, opts: string[]): Field => ({ label, ctl: "segmulti", opts });
const T = (label: string, opts: string[]): Field => ({ label, ctl: "segmulti", opts });
const X = (label: string, ph: string, tchips?: string[]): Field => ({ label, ctl: "text", ph, tchips });

const 용도지역 = ["전용주거", "제1종전용주거", "제2종전용주거", "일반주거", "제1종일반주거", "제2종일반주거", "제3종일반주거", "준주거", "중심상업", "일반상업", "근린상업", "유통상업", "전용공업", "일반공업", "준공업", "보전녹지", "생산녹지", "자연녹지", "도시지역미지정", "관리지역", "계획관리", "생산관리", "보전관리", "농림", "자연환경보전"];
const 지목 = ["전", "답", "과수원", "목장용지", "임야", "광천지", "염전", "대", "공장용지", "학교용지", "주차장", "주유소용지", "창고용지", "도로", "철도용지", "제방", "하천", "구거", "유지", "양어장", "수도용지", "공원", "체육용지", "유원지", "종교용지", "사적지", "묘지", "잡종지"];
const 이용상황섹터 = [
  { name: "상업용 빌딩", items: ["상업용", "업무용", "상업기타"] },
  { name: "상가주택", items: ["주상용", "주상기타"] },
  { name: "주거", items: ["단독", "연립", "다세대", "아파트", "주거기타"] },
  { name: "공업·산업", items: ["공업용", "공업기타"] },
  { name: "신축부지", items: ["주거나지", "상업나지", "주상나지", "공업나지", "주차장등"] },
  { name: "특수·기타시설", items: ["전", "과수원", "전기타", "전창고", "전축사", "답", "답기타", "답창고", "조림", "자연림", "토지임야", "임야기타", "유원지", "골프장 회원제", "여객자동차터미널", "콘도미니엄", "공항", "고속도로휴게소", "발전소", "물류터미널", "특수기타", "도로등", "하천등", "공원등", "운동장등", "위험시설", "유해.혐오시설", "기타"] },
];
const 디벨롭 = ["단독", "연립", "다세대", "주거기타", "공업용", "공업기타", "상업용", "업무용", "상업기타", "주상용", "주상기타"];
const 형상 = ["정방형", "가로장방", "세로장방", "사다리형", "부정형", "자루형"];
const 도로접면 = ["광대로한면", "광대소각", "광대세각", "중로한면", "중로각지", "소로한면", "소로각지", "세로한면(가)", "세로각지(가)", "세로한면(불)", "세로각지(불)", "맹지"];
const 주용도주 = ["단독주택", "공동주택", "제1종근린생활시설", "제2종근린생활시설", "판매시설", "의료시설", "교육연구시설", "노유자시설", "운동시설", "업무시설", "숙박시설", "위락시설", "공장", "창고시설", "자동차관련시설"];
const 주용도부 = ["문화및집회시설", "종교시설", "운수시설", "수련시설", "위험물저장및처리시설", "동물및식물관련시설", "자원순환관련시설", "교정및군사시설", "국방,군사시설", "방송통신시설", "발전시설", "묘지관련시설", "관광휴게시설", "장례시설", "야영장시설", "분뇨.쓰레기처리시설", "가설건축물", "근린생활시설", "판매및영업시설", "교육연구및복지시설", "공공용시설"];

export const GROUPS: Group[] = [
  { t: "입지정보",
    reps: [S("역과의거리", { min: 0, max: 1000, unit: "m", inf: true, handle: "right", ticks: "0,500", le: "이내", chips: [["도보5분↓", 0, 350], ["도보10분↓", 0, 700]] })],
    body: [M("유동인구", ["매우높음", "높음", "보통", "낮음", "매우낮음"])] },
  { t: "건물정보",
    reps: [
      S("대지면적", { min: 0, max: 300, unit: "평", inf: true, ticks: "0,100,200" }),
      S("연면적", { min: 0, max: 500, unit: "평", inf: true, ticks: "0,150,300" }),
      S("건축면적", { min: 0, max: 200, unit: "평", inf: true, ticks: "0,50,100" }),
      S("엘리베이터", { min: 0, max: 6, unit: "대", inf: true, handle: "left", ticks: "0,2,4" }),
      S("주차장", { min: 0, max: 20, unit: "대", inf: true, handle: "left", ticks: "0,5,10" }),
      S("사용승인일", { min: 0, max: 30, unit: "년", inf: true, handle: "right", ticks: "0,10,20", le: "이하", chips: [["신축 5년↓", 0, 5], ["준신축 10년↓", 0, 10], ["구옥 20년↑", 20, ""]] }),
    ],
    body: [
      S("용적률산정용연면적", { min: 0, max: 500, unit: "평", inf: true, ticks: "0,150,300" }),
      S("건폐율", { min: 0, max: 100, unit: "%", inf: true, ticks: "0,50,60,80" }),
      S("법정건폐율", { min: 0, max: 100, unit: "%", inf: true, ticks: "0,50,60,80" }),
      S("용적률", { min: 0, max: 1000, unit: "%", inf: true, ticks: "0,300,600" }),
      S("법정용적률", { min: 0, max: 1000, unit: "%", inf: true, ticks: "0,300,600" }),
      S("건폐율 여유분", { min: 0, max: 100, unit: "%p", inf: true, handle: "left", ticks: "0,20,40", chips: [["여유 10%p↑", 10, ""], ["여유 20%p↑", 20, ""]] }),
      S("용적률 여유분", { min: 0, max: 500, unit: "%p", inf: true, handle: "left", ticks: "0,100,200", chips: [["여유 100%p↑", 100, ""], ["여유 200%p↑", 200, ""]] }),
      S("규모 지상", { min: 0, max: 30, unit: "층", inf: true, handle: "left", ticks: "0,10,20" }),
      S("규모 지하", { min: 0, max: 10, unit: "층", inf: true, handle: "left", ticks: "0,3,6" }),
      S("대수선 경과연수", { min: 0, max: 30, unit: "년", inf: true, handle: "right", le: "이하", ticks: "0,10,20" }),
      TM("주용도", [{ name: "주요 용도", open: true, items: 주용도주 }, { name: "그 외 용도", items: 주용도부 }]),
      X("기타용도", "건축물대장 기타용도 · 부분일치", ["근린생활시설", "사무소", "업무시설", "단독주택", "다가구주택", "소매점", "판매시설", "상가"]),
    ] },
  { t: "토지정보",
    reps: [MD("용도지역", 용도지역)],
    body: [
      S("토지면적", { min: 0, max: 300, unit: "평", inf: true, ticks: "0,100,200" }),
      MD("지목", 지목), GRP("토지이용상황", 이용상황섹터, [{ name: "디벨롭", items: 디벨롭 }]), M("지형형상", 형상), MD("도로접면", 도로접면),
      M("지세", ["저지", "평지", "완경사", "급경사", "고지"]),
    ] },
  { t: "금액정보",
    reps: [
      S("매매가", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100,150", chips: [["~50억", 0, 50], ["50~100", 50, 100], ["100억~", 100, ""]] }),
      S("수익률(현재)", { min: 0, max: 8, step: 0.1, unit: "%", inf: true, handle: "left", ticks: "0,2,4,6", chips: [["3%↑", 3, ""], ["4%↑", 4, ""], ["5%↑", 5, ""]] }),
    ],
    body: [
      S("평단가(대지)", { min: 0, max: 30000, unit: "만원", inf: true, ticks: "0,5000,10000,20000" }),
      S("평단가(연면적)", { min: 0, max: 15000, unit: "만원", inf: true, ticks: "0,3000,6000,10000" }),
      S("총보증금", { min: 0, max: 100000, unit: "만원", inf: true, ticks: "0,10000,30000,50000" }),
      S("총임대료", { min: 0, max: 10000, unit: "만원", inf: true, ticks: "0,2000,5000" }),
      S("총관리비", { min: 0, max: 5000, unit: "만원", inf: true, ticks: "0,1000,3000" }),
      S("수익률(만실)", { min: 0, max: 8, step: 0.1, unit: "%", inf: true, handle: "left", ticks: "0,2,4,6" }),
      S("공실제외수익률", { min: 0, max: 8, step: 0.1, unit: "%", inf: true, handle: "left", ticks: "0,3,6" }),
      T("총공실", ["있음", "없음"]),
    ] },
  { t: "상세정보",
    reps: [M("건물용도", ["수익률", "신축용", "사옥용", "리모델링용"])],
    body: [
      SM("등급", ["매우좋음", "좋음", "나쁨", "매우나쁨"]), SM("입지", ["매우좋음", "좋음", "나쁨", "매우나쁨"]),
      M("명도", ["완료", "가능", "불가", "일부", "조건부"]),
      M("용도변경", ["나대지(주차장)", "근생", "상가주택", "다가구주택", "다세대주택", "가능", "불가", "협의가능", "조건부"]),
      M("멸실", ["불가", "협조가능", "잔금전멸실", "나대지(주차장)", "협의가능", "조건부"]),
    ] },
  { t: "공시지가·실거래·광고",
    reps: [
      S("광고가", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100" }),
      S("실거래일", { min: 1970, max: 2026, unit: "", inf: true, inflo: true, handle: "left", ge: "부터", le: "까지", ticks: "1990,2010" }),
    ],
    body: [
      S("최신 공시지가", { min: 0, max: 5000, unit: "만원/㎡", inf: true, ticks: "0,1000,3000" }),
      S("공시지가 상승률 5년", { min: 0, max: 100, unit: "%", inf: true, handle: "left", ticks: "0,30,60" }),
      S("공시지가 상승률 10년", { min: 0, max: 200, unit: "%", inf: true, handle: "left", ticks: "0,50,100" }),
      S("총공시지가/매매가", { min: 0, max: 200, unit: "%", inf: true, ticks: "0,50,100" }),
      S("공시지가 기준", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100,150" }),
      S("광고 상승률", { min: -50, max: 100, unit: "%", inf: true, inflo: true, ticks: "-50,0,50" }),
      T("광고 상태", ["광고중", "광고없음"]),
      S("실거래가", { min: 0, max: 200, unit: "억", inf: true, ticks: "0,50,100" }),
      S("실거래손익", { min: -50, max: 200, unit: "%", inf: true, inflo: true, ticks: "-50,0,50,100" }),
      S("실거래횟수", { min: 0, max: 10, unit: "건", inf: true, handle: "left", ticks: "0,3,6" }),
    ] },
  { t: "업무",
    reps: [M("진행상태", ["준비중", "진행중", "철회", "가격제시", "매각"]), M("소유자타입", ["개인", "법인"])],
    body: [
      M("담당자", ["이승욱", "박실장", "김대리"]),
      M("긴급도", ["매우급함", "급함", "보통", "여유", "안팔아도됨"]),
      M("관계", ["건물주/법인대표", "관리자", "친인척", "부동산", "기타"]),
      M("협조도", ["협조적", "보통", "비협조적"]), M("친절도", ["친절", "보통", "불친절"]),
      X("소유자명", "소유자명"), X("매물번호", "매물번호"),
      S("접수일", { min: 1970, max: 2026, unit: "", inf: true, inflo: true, handle: "left", ge: "부터", le: "까지", ticks: "2000,2015" }),
      T("매수의향서", ["원함", "원치않음"]), T("전화번호", ["있음", "없음"]),
      T("사진", ["있음", "없음"]), T("브리핑", ["있음", "없음"]),
    ] },
];
