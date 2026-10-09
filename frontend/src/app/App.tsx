import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantPage } from "../features/assistant/AssistantPage";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { DocPage } from "../features/sales/draft/DocPage";
import { AuthGuard } from "./AuthGuard";
import { Shell } from "./Shell";
import { refresh } from "../shared/api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { LandingPage } from "../features/landing/LandingPage";
import { SurveyPage } from "../features/beta/SurveyPage";
import { Beta1Survey } from "../features/beta/Beta1Survey";
import { OnboardingPage } from "../features/landing/OnboardingPage";
import { SearchPage } from "../features/search/SearchPage";
import { NewsPage } from "../features/news/NewsPage";
import { BuildingRedirect, ParcelSheetRoute } from "../features/building/BuildingSheet";
import { ArtifactPage } from "../features/artifact/ArtifactPage";
import { MyPage } from "../features/mypage/MyPage";
import { SalesPage, CustomersPage, SchedulePage } from "../features/sales/SalesPage";
import { IconSprite } from "../shared/ui/Icon";
import { ErrorBoundary } from "../shared/ui/ErrorBoundary";
import { useIsBroker } from "../shared/store/auth";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

export function App() {
  // 세션 복원: 마운트 시 httpOnly refresh 쿠키로 access 재발급 시도(완료 전 라우팅 보류)
  const [booted, setBooted] = useState(false);
  useEffect(() => { refresh().finally(() => setBooted(true)); }, []);
  if (!booted) return null;

  return (
    <QueryClientProvider client={qc}>
      <IconSprite />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/survey" element={<SurveyPage />} />
          {/* 1차 마무리 설문(2026-08-20) — 로그인 없이, 링크로 뿌린다 */}
          <Route path="/survey/beta1" element={<Beta1Survey />} />
          <Route path="/welcome" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          {/* 셸은 손님도 들어온다(10-01) — 매물 찾기 · 구해요 · 소식 · 상세보기는 로그인 없이. 나머지는 칸마다 AuthGuard */}
          <Route element={<Shell />}>
            {/* 매물 찾기 · 구해요(S06) — 한 화면 틀, 필터는 세션으로 같이 쓴다. key 로 갈아 끼워 상태가 섞이지 않게 */}
            <Route path="/search" element={<ErrorBoundary key="sale"><SearchPage mode="sale" /></ErrorBoundary>} />
            <Route path="/seek" element={<ErrorBoundary key="seek"><SearchPage mode="seek" /></ErrorBoundary>} />
            {/* 매물 탐색(S08) — 중개사만. 손님 · 고객은 매물 찾기로 */}
            <Route path="/explore" element={<AuthGuard><BrokerOnly><ErrorBoundary key="explore"><SearchPage mode="explore" /></ErrorBoundary></BrokerOnly></AuthGuard>} />
            {/* AI 어시스턴트 — 10-AI-어시스턴트 1단계 */}
            <Route path="/assistant" element={<AuthGuard><ErrorBoundary><AssistantPage /></ErrorBoundary></AuthGuard>} />
            <Route path="/news" element={<ErrorBoundary><NewsPage /></ErrorBoundary>} />
            {/* 상세보기 = 건물 사양서(10-01) — 탐색에선 모달, 여기선 새 탭 페이지. 옛 BuildingPage(팀 편집 · 보고서)는 걷었다 */}
            <Route path="/buildings/:pk" element={<ErrorBoundary><BuildingRedirect /></ErrorBoundary>} />
            {/* 나대지 — 건물이 없는 필지. building_pk 가 없어 pnu 로 가리킨다(2026-08-27) */}
            <Route path="/parcels/:pnu" element={<ErrorBoundary><ParcelSheetRoute /></ErrorBoundary>} />
            <Route path="/sales" element={<AuthGuard><ErrorBoundary><SalesPage /></ErrorBoundary></AuthGuard>} />
            <Route path="/customers" element={<AuthGuard><ErrorBoundary><CustomersPage /></ErrorBoundary></AuthGuard>} />
            <Route path="/schedule" element={<AuthGuard><ErrorBoundary><SchedulePage /></ErrorBoundary></AuthGuard>} />
            <Route path="/mypage" element={<AuthGuard><ErrorBoundary><MyPage /></ErrorBoundary></AuthGuard>} />
            {/* 내 페이지 묶음 하나(S09 · 10-04) — 내 투자 · 최근 본 · 관심 · 구해요 · 보낸 문의 · 내 중개사무소 · 계정 */}
            <Route path="/mypage/:section" element={<AuthGuard><ErrorBoundary><MyPage /></ErrorBoundary></AuthGuard>} />
          </Route>
          {/* 헤더 없는 전체화면(새 탭으로 여는 독립 뷰) — 자료 · 계약 문서 */}
          <Route element={<AuthGuard><div className="fullview" style={{ height: "100vh", overflow: "hidden" }}><Outlet /></div></AuthGuard>}>
            <Route path="/artifacts/:id" element={<ErrorBoundary><ArtifactPage /></ErrorBoundary>} />
            {/* 계약 문서(초안) — 모달이 아니라 새 탭. 종이는 크게 본다 */}
            <Route path="/deals/:lid/papers" element={<ErrorBoundary><DocPage /></ErrorBoundary>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** 중개사 전용 칸 — 손님 · 고객이 주소로 들어오면 매물 찾기로 돌려보낸다(S08 §1) */
function BrokerOnly({ children }: { children: React.ReactNode }) {
  return useIsBroker() ? <>{children}</> : <Navigate to="/search" replace />;
}
