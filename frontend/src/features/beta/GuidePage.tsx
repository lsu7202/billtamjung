import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./beta.css";

/* 베타 안내 — 광고 영상 + 사용 매뉴얼(핵심 4단계) + PDF 다운로드. 로그인 불필요(공개 페이지). */

const STEPS = [
  {
    n: "01", t: "찾는다", sub: "매물 검색",
    d: "주소를 알면 검색창에, 조건만 있으면 필터로. 서울의 모든 상업용 건물이 대상이라 아직 시장에 나오지 않은 건물도 걸립니다.",
    img: "01-검색.png",
    caps: ["검색창에 주소·건물명·역 이름을 입력하면 자동완성", "필터는 매매가·수익률·연식·용도지역 등 60여 조건", "지도에 직접 영역을 그려 행정경계 밖 범위도 지정"],
  },
  {
    n: "02", t: "파악한다", sub: "매물 상세",
    d: "적정가·수익률·매력도·투자유형을 한 화면에서 확인합니다. 값이 실제와 다르면 그 자리에서 고칠 수 있고, 원본은 그대로 보존됩니다.",
    img: "02-리포트요약.png",
    caps: ["리포트 요약 = 이 건물의 결론만 모은 화면", "수정한 값은 우리 팀에게만 보이고 언제든 되돌리기", "층별 임대를 입력하면 수익률이 실측 기반으로"],
  },
  {
    n: "03", t: "상권을 정한다", sub: "주변 비교",
    d: "적정가와 주변시세는 '주변'의 범위에 따라 달라집니다. 지도에서 직접 그리면 그 범위로 다시 계산됩니다.",
    img: "03-상권정의.png",
    caps: ["원의 가장자리를 끌면 반경, 가운데를 끌면 위치", "정한 범위의 임대시세·실거래가 자동 갱신", "설정은 팀 전체에 공유"],
  },
  {
    n: "04", t: "리포트를 만든다", sub: "빌탐정 리포트",
    d: "생성 전에 근거 사례를 직접 검토합니다. 안 맞는 거래는 빼고, 틀린 정보는 고치면 적정가가 즉시 다시 계산됩니다.",
    img: "06-검토.png",
    caps: ["검토 단계는 크레딧이 들지 않습니다", "생성은 크레딧 30 — 실패 시 차감 없음", "웹 슬라이드 10장 + PPT 다운로드"],
  },
];

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
          <video src="/beta/ad.mp4" autoPlay muted loop playsInline controls={false}
            onClick={(e) => { const v = e.currentTarget; v.muted = !v.muted; }} />
          <span className="bt-hero-hint">클릭하면 소리가 켜집니다</span>
        </div>
        <div className="bt-hero-in">
          <span className="bt-eyebrow">베타 테스터 안내</span>
          <h1>빌탐정, 이렇게 씁니다</h1>
          <p>서울의 모든 상업용 건물에서 찾아내고, 가치를 분석하고, 고객용 리포트까지 — 30분이면 전부 익힙니다.</p>
          <div className="bt-cta">
            <a className="bt-btn primary" href="/beta/manual.pdf" target="_blank" rel="noreferrer">매뉴얼 PDF 받기</a>
            <Link className="bt-btn" to="/survey">설문 참여하기</Link>
            <Link className="bt-btn ghost" to="/search">빌탐정 열기</Link>
          </div>
        </div>
      </header>

      <main className="bt-main">
        <section className="bt-intro">
          <h2>30분이면 충분합니다</h2>
          <p>
            아래 네 단계가 빌탐정의 전부입니다. 실제 건물 한 채(<b>강남구 신사동 561-9</b>)를 따라가며 설명합니다 —
            화면은 모두 실제 캡처이며, 이미지를 누르면 크게 볼 수 있습니다.
          </p>
          <div className="bt-rules">
            <div><b>검색은 무제한</b><span>크레딧은 리포트 생성(30)에만. 가입 시 60 지급</span></div>
            <div><b>원본은 안전</b><span>수정은 우리 팀에게만 보이고 되돌리기 가능</span></div>
            <div><b>팀 단위 공유</b><span>정보·임대·상권·사진은 팀원이 함께 봅니다</span></div>
          </div>
        </section>

        {STEPS.map((s) => (
          <section className="bt-step" key={s.n}>
            <div className="bt-step-h">
              <span className="no">{s.n}</span>
              <h3>{s.t}</h3>
              <span className="sub">{s.sub}</span>
            </div>
            <p className="bt-step-d">{s.d}</p>
            <button className="bt-shot" onClick={() => setShot(s.img)} aria-label={`${s.t} 화면 크게 보기`}>
              <img src={`/beta/img/${s.img}`} alt={`${s.t} 화면`} loading="lazy" />
            </button>
            <ul className="bt-caps">{s.caps.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        ))}

        <section className="bt-note">
          <h3>숫자를 읽는 법</h3>
          <dl>
            <dt>적정가가 실거래와 다르다면</dt>
            <dd>주변 사례로 추정한 값이라 개별 사정(급매·내부 상태)은 담기지 않습니다. 검토 화면에서 어떤 사례로 계산됐는지 직접 확인하고 조정할 수 있습니다.</dd>
            <dt>수익률이 5%를 넘는다면</dt>
            <dd>서울 상업용 건물은 대체로 2~4%대입니다. 그 이상이면 임대료 추정이 높게 잡혔을 가능성이 큽니다 — 층별 임대를 입력하면 정확해집니다.</dd>
            <dt>적정가가 표시되지 않는다면</dt>
            <dd>주거용 건물이거나 주변 비교 거래가 3건 미만인 경우입니다. 상권 범위를 넓히면 사례가 늘어납니다.</dd>
          </dl>
        </section>

        <section className="bt-end">
          <h3>의견을 들려주세요</h3>
          <p>베타의 목표는 완성이 아니라 개선입니다. 불편했던 점이 가장 큰 도움이 됩니다.</p>
          <div className="bt-cta">
            <Link className="bt-btn primary" to="/survey">설문 참여하기 (5분)</Link>
            <a className="bt-btn ghost" href="/beta/survey.pdf" target="_blank" rel="noreferrer">설문지 PDF</a>
          </div>
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
