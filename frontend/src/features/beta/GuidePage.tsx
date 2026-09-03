import { useEffect, useRef, useState } from "react";
import "./beta.css";

/* 베타 안내 — 광고 영상 + 핵심 섹션별 가로 슬라이드 매뉴얼. 로그인 불필요(공개). */

type Slide = { t: string; img?: string; cap?: string; steps?: string[]; rows?: [string, string][]; note?: { t: string; d: string } };
type Sec = { id: string; no: string; t: string; sub: string; lead: string; slides: Slide[] };

const SECTIONS: Sec[] = [
  {
    id: "search", no: "01", t: "주소로 찾기", sub: "건물 검색",
    lead: "주소·동 이름·역 이름으로 바로 엽니다.",
    slides: [
      { t: "검색창에 입력", img: "01-검색.png", cap: "① 검색어 입력 · ② 요약 카드 · ③ 상세보기",
        steps: [
          "주소·동 이름·역 이름을 입력 — 띄어쓰기 없어도 되고 지번 일부만 쳐도 됩니다.",
          "자동완성에서 건물을 고르면 지도가 이동하고 왼쪽에 요약 카드가 뜹니다.",
          "「상세보기 →」로 상세 화면(새 탭)을 엽니다.",
        ],
        note: { t: "'번지'는 빼고 입력", d: "역삼동 659번지 ✗ · 역삼동 659 ✓" } },
      { t: "지도 도구", rows: [
        ["거리재기 · 면적 · 반경", "지도에서 바로 측정"],
        ["지적도", "필지 경계선 표시"],
        ["로드뷰 · 위성", "외관·주변 환경 확인"],
      ] },
    ],
  },
  {
    id: "filter", no: "02", t: "조건으로 발굴하기", sub: "상세검색 필터",
    lead: "매물로 나오지 않은 건물을 조건으로 찾아냅니다.",
    slides: [
      { t: "조건 지정하는 법", img: "12-조건팝오버.png", cap: "화면의 번호가 아래 순서와 같습니다",
        steps: [
          "지역을 먼저 정합니다 — 시/군/구를 고르면 구 전체, 법정동을 추가하면 동 단위(여러 개 가능).",
          "왼쪽에서 카테고리를 고릅니다(옆 숫자 = 그 카테고리에 걸린 조건 수).",
          "조건 칩을 누릅니다 — 예: 건물정보 › 사용승인일.",
          "슬라이더를 끌거나, 숫자를 직접 입력하거나, 프리셋 버튼을 누릅니다(신축 5년↓ / 준신축 10년↓ / 구옥 20년↑).",
          "지정한 조건이 「적용된 조건」 줄에 칩으로 쌓입니다 — × 로 개별 해제, 「전체 초기화」로 모두 해제.",
          "하단 「적용」을 누르면 결과가 갱신됩니다.",
        ],
        note: { t: "슬라이더 범위 밖의 값", d: "숫자를 직접 입력하면 그대로 적용됩니다 — 매매가 800억, 연면적 5,000평 모두 가능. 한쪽만 채우면 '이상'·'이하' 단방향 조건이 됩니다." } },
      { t: "카테고리별 조건", img: "11-필터카테고리.png", cap: "① 카테고리 목록 · ② 대표조건 · ③ 세부조건 · ④ 영역 그리기", rows: [
        ["자주 찾는 조건", "대표 조건만 모아둔 화면 — 여기서 대부분 해결됩니다"],
        ["입지정보", "역과의 거리 · 유동인구"],
        ["건물정보", "대지/연면적/건축면적 · 엘리베이터 · 주차 · 사용승인일 · 건폐율/용적률과 여유분 · 규모 · 대수선 경과연수 · 주용도"],
        ["토지정보", "토지면적 · 지목 · 토지이용상황 · 지형형상 · 도로접면 · 지세"],
        ["금액정보", "매매가 · 수익률(만실/공실제외) · 평단가 · 총보증금/임대료/관리비 · 공실"],
        ["상세정보", "건물용도(수익형·신축용·사옥용·리모델링용) · 등급 · 입지 · 명도 · 용도변경 · 멸실"],
        ["공시지가·실거래", "공시지가와 5·10년 상승률 · 공시지가/매매가 · 실거래가 · 실거래일 · 거래 횟수"],
        ["업무", "진행상태 · 담당자 · 긴급도 · 소유자타입 · 매물번호 · 접수일"],
      ] },
      { t: "알아두면 강력한 조건", rows: [
        ["용적률 여유분", "법정 − 현재 용적률. 증축·신축 여지가 남은 건물을 찾을 때(예: 여유 100%p 이상)"],
        ["공시지가/매매가", "비율이 높으면 땅값 대비 저평가 신호"],
        ["실거래일", "「10년↑ 미거래」로 걸면 오래 손바뀜이 없던 건물이 나옵니다"],
        ["대수선 경과연수", "노후 건물 중 관리된 물건 선별"],
        ["조건 저장", "우측 상단 「조건저장」에 이름을 붙여두면 다음부터 「불러오기」로 한 번에 재적용"],
      ] },
    ],
  },
  {
    id: "draw", no: "03", t: "지도에 영역 그리기", sub: "행정경계 밖의 범위",
    lead: "대로 하나로 갈리는 상권, 역세권 안쪽만 — 직접 그려서 자릅니다.",
    slides: [
      { t: "그리면 그 안쪽만", img: "13-그리기도구.png", cap: "① 그리기 도구 줄 · ② 그린 영역 · ③ 「그린 영역」 칩",
        steps: [
          "지도 하단 도구 또는 필터의 「지도에서 영역 그리기」로 시작합니다.",
          "그리면 파란 폴리곤이 표시되고 상단에 「그린 영역」 칩이 생깁니다 — 지역 선택을 대체합니다.",
          "지우려면 「그린 영역 ×」 칩 또는 지도 도구의 삭제(빨간 아이콘). 다시 그리면 이전 영역은 대체됩니다.",
        ] },
      { t: "도구 5가지", rows: [
        ["자유곡선", "누른 채 드래그해 원하는 모양을 그립니다. 손을 떼면 그 궤적이 영역 — 이어 그리면 확장됩니다"],
        ["다각형", "꼭짓점을 하나씩 클릭하고 마지막에 더블클릭으로 닫습니다. 직선 경계를 정확히 잡을 때"],
        ["자석 올가미", "대충 그리면 필지 경계에 자동으로 달라붙습니다. 블록 단위로 자를 때 가장 편합니다"],
        ["원 반경", "중심을 누르고 바깥으로 드래그. '이 지점에서 300m' 같은 범위"],
        ["자", "직선 가이드 — 그릴 때 자 가장자리에 대면 선이 반듯하게 붙습니다"],
      ] },
      { t: "검색 결과 읽기", img: "10-검색결과.png", rows: [
        ["내 매물 / 일반", "팀이 담당자를 지정한 건물은 내 매물 열로 분리"],
        ["정렬", "매매가순 · 수익률순 (값 없는 건물은 뒤로)"],
        ["카드의 가격", "팀이 매매가를 안 적었으면 빌탐정 추정가가 표시됩니다"],
        ["지도 핀", "검은 원 안 숫자 = 그 구역의 건물 수. 확대하면 개별 핀으로 나뉩니다"],
      ] },
    ],
  },
  {
    id: "detail", no: "04", t: "건물 상세 읽기", sub: "리포트 요약",
    lead: "건물 하나의 결론이 한 화면에.",
    slides: [
      { t: "요약 화면", img: "02-리포트요약.png", cap: "① 추정가 · ② 가격 비교 · ③ 예상수익률 · ④ 매력도 · ⑤ 리포트 만들기",
        rows: [
          ["① 추정가", "주변 실거래를 토지·건물 가치로 나눠 비교하고 연식·시점·규모를 보정한 값. 상업·업무용만 산출"],
          ["② 가격 비교", "추정가 · 실거래 · 공시지가 총액을 나란히"],
          ["③ 예상수익률", "연 임대수익 ÷ 매매가. 주변 평균과 비교"],
          ["④ 매력도", "S~D 등급 + 8축 레이더(도로접면·역거리·용도지역 등)"],
          ["⑤ 리포트 만들기", "검토 화면으로 이동"],
          ["아래로 계속", "투자 유형(신축용·리모델링용·수익형) · 미래가치 · 상권 지도"],
        ],
        note: { t: "표시 범위", d: "상단에서 리포트 요약 / 전체 / 매물 / 건물·토지를 골라 필요한 만큼만 봅니다." } },
      { t: "가격 3층 구조", rows: [
        ["매도희망가", "건물주가 부르는 값"],
        ["매매가", "중개인 판단 — 비우면 추정가가 대신 쓰입니다"],
        ["빌탐정 추정가", "시스템 산출"],
        ["협의 필요금액", "매도희망가와 매매가를 함께 적으면 자동 계산"],
      ] },
    ],
  },
  {
    id: "edit", no: "05", t: "정보 고치기 · 임대 입력", sub: "팀 공유",
    lead: "대장이 실제와 다를 때, 임대를 실측으로 바꿀 때.",
    slides: [
      { t: "값 수정", img: "14-값수정.png",
        steps: [
          "고칠 값을 클릭합니다(금액·면적·용도·상태 등 대부분의 항목).",
          "숫자·텍스트는 입력, 정해진 항목은 목록에서 선택합니다.",
          "입력을 마치면 자동 저장됩니다 — 별도 저장 버튼이 없습니다.",
          "되돌리려면 항목의 되돌리기, 전부는 화면 하단 「↺ 전체 되돌리기」.",
        ],
        note: { t: "수정은 우리 팀에게만", d: "공공데이터 원본은 그대로 남고 팀 화면에만 덮어써집니다. 고친 값은 추정가·평단가·수익률 계산에도 즉시 반영됩니다." } },
      { t: "층별 임대 입력", img: "15-층별임대.png", cap: "① 층 클릭 → 펼침 · ② 호실 면적 · ③ 보증금·임대료 · ④ 상태(공실)",
        steps: [
          "대장 기준 층·호실이 미리 채워져 있고, 보증금·임대료에는 추정치가 들어가 있습니다.",
          "층을 클릭하면 호실이 펼쳐집니다 — 층 행의 값은 그 층 호실들의 합계입니다.",
          "실제 계약을 아는 호실은 보증금·임대료·관리비·면적을 직접 입력합니다.",
          "비어 있는 호실은 상태를 공실로 지정하면 수익률(공실제외)이 따로 계산됩니다.",
          "입력한 층은 추정치 대신 실측값이 쓰이고 총임대료·수익률이 즉시 갱신됩니다.",
        ] },
    ],
  },
  {
    id: "market", no: "06", t: "주변 상권 정하기", sub: "비교 기준 설정",
    lead: "추정가와 주변시세는 '주변'의 범위로 달라집니다.",
    slides: [
      { t: "직접 그리기", img: "03-상권정의.png", cap: "① 중심 = 이동 · ② 가장자리 = 크기 · ③ 반경·면적 · ④ 완료",
        steps: [
          "지도 우측 상단 「주변상권 정의하기」를 누릅니다(지도가 전체화면으로 커집니다).",
          "원 가장자리를 끌면 반경이, 가운데 점을 끌면 위치가 바뀝니다 — 하단에 반경·면적이 실시간 표시.",
          "좌측 상단 도구에서 자유곡선을 고르면 원 대신 임의 모양으로 그릴 수 있습니다.",
          "「완료」를 누르면 저장되고 주변 매물·임대시세가 새 범위로 갱신됩니다.",
        ],
        note: { t: "팀 전체에 적용", d: "설정한 상권은 팀원 모두에게 공유되고, 이후 만드는 리포트의 계산 범위가 됩니다." } },
      { t: "범위 안에서 보는 것", img: "04-주변매물.png", rows: [
        ["주변 임대시세", "범위 안 건물들의 층별 평당 보증금·임대료 평균 — 본 매물의 층 구성에 맞춰 표시"],
        ["주변 실거래", "최근 5년, 매물별 최근 거래. 거리·거래일·실거래가·평단가. 주소 클릭 시 그 건물로 이동"],
      ] },
    ],
  },
  {
    id: "report", no: "07", t: "리포트 만들기", sub: "검토 → 생성",
    lead: "근거를 직접 다듬고 만듭니다.",
    slides: [
      { t: "검토 단계", img: "06-검토.png", cap: "① 사례 체크 해제 · ② 행 클릭 → 편집 · ③ 실시간 결과 · ④ 생성 확정",
        steps: [
          "상세 화면 우측 상단 「매물 분석하기 (30)」을 누릅니다.",
          "사례를 고릅니다 — 체크를 해제하면 그 거래가 계산에서 빠집니다(「이상치」 표시는 처음부터 해제됨).",
          "사례 행을 클릭하면 도로접면·역거리·용도지역·형상·승인일·엘리베이터를 그 자리에서 수정할 수 있습니다.",
          "조정할 때마다 우측 적정매매가가 즉시 갱신됩니다 — 여기까지 크레딧은 들지 않습니다.",
          "「생성 확정 (크레딧 30)」을 누르면 만들어집니다. 실패 시 차감되지 않습니다.",
        ],
        note: { t: "사진을 먼저 올리세요", d: "상세 화면의 「업로드 사진」 탭에서 + 로 현장 사진을 추가합니다. 첫 번째 사진이 리포트 표지에 들어갑니다." } },
      { t: "결과물", img: "07-리포트1.png", rows: [
        ["구성", "표지 · 핵심 요약 · 기본정보 · 매력도 · 가격분석 · 근거 사례 · 공시지가 · 임대현황 · 수익률 · 투자유형 · 미래가치"],
        ["애니메이션 모드", "발표용 — 요소가 순서대로 나타납니다"],
        ["전체화면", "미팅 화면 공유용"],
        ["보관", "마이페이지 › 내 산출물에 계속 남습니다"],
      ],
        note: { t: "만든 순간으로 고정", d: "이후 시세가 변해도 그때의 근거가 보존됩니다. 최신 값이 필요하면 새로 생성하세요." } },
    ],
  },
];



/* 가로 슬라이드 한 섹션 */
function Section({ sec, onZoom }: { sec: Sec; onZoom: (img: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const go = (n: number) => {
    const el = track.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(sec.slides.length - 1, n));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    setI(clamped);
  };
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setI(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="gsec" id={sec.id}>
      <div className="gsec-h">
        <span className="no">{sec.no}</span>
        <h2>{sec.t}</h2>
        <span className="sub">{sec.sub}</span>
      </div>
      <p className="gsec-lead">{sec.lead}</p>

      <div className="gcar">
        <div className="gtrack" ref={track}>
          {sec.slides.map((s, k) => (
            <article className="gslide" key={k}>
              <h3>{s.t}</h3>
              {s.img && <Shot img={s.img} onZoom={onZoom} />}
              {s.cap && <p className="gcap">{s.cap}</p>}
              {s.steps && <ol className="gsteps">{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>}
              {s.rows && (
                <dl className="grows">
                  {s.rows.map(([k2, v]) => (<div key={k2}><dt>{k2}</dt><dd>{v}</dd></div>))}
                </dl>
              )}
              {s.note && <div className="gnote"><b>{s.note.t}</b>{s.note.d}</div>}
            </article>
          ))}
        </div>

        {sec.slides.length > 1 && (
          <>
            <button className="gnav prev" onClick={() => go(i - 1)} disabled={i === 0} aria-label="이전">‹</button>
            <button className="gnav next" onClick={() => go(i + 1)} disabled={i === sec.slides.length - 1} aria-label="다음">›</button>
            <div className="gdots">
              {sec.slides.map((s, k) => (
                <button key={k} className={"gdot" + (k === i ? " on" : "")} onClick={() => go(k)} aria-label={s.t}>
                  <span>{s.t}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

type Ann = { n: number; x: number; y: number; w: number; h: number; label: string };

/* 캡처 위 번호 박스 — annotations.json(1440×900 기준 %) */
function Shot({ img, onZoom }: { img: string; onZoom: (i: string) => void }) {
  const [ann, setAnn] = useState<Ann[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/beta/annotations.json").then((r) => r.json())
      .then((j) => { if (alive) setAnn(j[img] ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [img]);
  return (
    <button className="gshot" onClick={() => onZoom(img)} aria-label="화면 크게 보기">
      <span className="gshot-in">
        <img src={`/beta/img/${img}`} alt="" loading="lazy" />
        {ann.map((a) => (
          <span key={a.n} className="gmk" style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}>
            <span className="gmk-b">{a.n}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

export function GuidePage() {
  const [shot, setShot] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setShot(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return (
    <div className="bt-beta">
      <header className="bt-hero">
        <div className="bt-hero-video">
          <video src="/beta/ad.mp4" autoPlay muted loop playsInline
            onClick={(e) => { const v = e.currentTarget; v.muted = !v.muted; }} />
          <span className="bt-hero-hint">클릭하면 소리가 켜집니다</span>
        </div>
        <div className="bt-hero-in">
          <span className="bt-eyebrow">베타 테스터 안내</span>
          <h1>빌탐정 사용 안내</h1>
          <div className="bt-cta">
            <a className="bt-btn primary" href="/beta/manual.pdf" target="_blank" rel="noreferrer">매뉴얼 PDF 내려받기</a>
          </div>
          <nav className="bt-toc">
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.no} {s.t}</a>)}
          </nav>
        </div>
      </header>

      <main className="bt-main">
        <section className="bt-watch">
          <div className="bt-watch-head">
            <span className="bt-eyebrow">영상으로 먼저 보기</span>
            <h2>화면을 따라가며 2분</h2>
            <p>찾기부터 리포트까지, 실제 화면에 번호를 짚어가며 설명합니다. 아래 글은 같은 내용을 화면별로 더 자세히 정리한 것입니다.</p>
          </div>
          <video src="/beta/manual.mp4" controls playsInline preload="metadata" />
        </section>

        {SECTIONS.map((s) => <Section key={s.id} sec={s} onZoom={setShot} />)}

        <section className="bt-end">
          <h3>의견을 들려주세요</h3>
          <p>불편했던 점이 가장 큰 도움이 됩니다. 매주 보내드리는 설문에 답해주시면 다음 버전에 반영합니다.</p>
        </section>
      </main>

      {shot && (
        <div className="bt-lightbox" onClick={() => setShot(null)}>
          <img src={`/beta/img/${shot}`} alt="확대 화면" />
        </div>
      )}
    </div>
  );
}
