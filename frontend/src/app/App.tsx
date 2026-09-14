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
import { GuidePage } from "../features/beta/GuidePage";
import { SurveyPage } from "../features/beta/SurveyPage";
import { Beta1Survey } from "../features/beta/Beta1Survey";
import { OnboardingPage } from "../features/landing/OnboardingPage";
import { SearchPage } from "../features/search/SearchPage";
import { NewsPage } from "../features/news/NewsPage";
import { ParcelPage } from "../features/building/ParcelPage";
import { BuildingPage } from "../features/building/BuildingPage";
import { ReportPage } from "../features/building/ReportPage";
import { BriefingPage } from "../features/building/BriefingPage";
import { ReportStory } from "../features/building/ReportStory";
import { MyPage } from "../features/mypage/MyPage";
import { SalesPage } from "../features/sales/SalesPage";
import { IconSprite } from "../shared/ui/Icon";
import { ErrorBoundary } from "../shared/ui/ErrorBoundary";

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
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/survey" element={<SurveyPage />} />
          {/* 1차 마무리 설문(2026-08-20) — 로그인 없이, 링크로 뿌린다 */}
          <Route path="/survey/beta1" element={<Beta1Survey />} />
          <Route path="/welcome" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          <Route element={<AuthGuard><Shell /></AuthGuard>}>
            <Route path="/search" element={<ErrorBoundary><SearchPage /></ErrorBoundary>} />
            {/* AI 어시스턴트 — 10-AI-어시스턴트 1단계 */}
            <Route path="/assistant" element={<ErrorBoundary><AssistantPage /></ErrorBoundary>} />
            <Route path="/news" element={<ErrorBoundary><NewsPage /></ErrorBoundary>} />
            <Route path="/buildings/:pk" element={<ErrorBoundary><BuildingPage /></ErrorBoundary>} />
            {/* 나대지 — 건물이 없는 필지. building_pk 가 없어 pnu 로 가리킨다(2026-08-27) */}
            <Route path="/parcels/:pnu" element={<ErrorBoundary><ParcelPage /></ErrorBoundary>} />
            <Route path="/sales" element={<ErrorBoundary><SalesPage /></ErrorBoundary>} />
            <Route path="/mypage" element={<ErrorBoundary><MyPage /></ErrorBoundary>} />
          </Route>
          {/* 보고서 = 헤더 없는 전체화면(새 탭으로 여는 독립 뷰) */}
          <Route element={<AuthGuard><div className="fullview" style={{ height: "100vh", overflow: "hidden" }}><Outlet /></div></AuthGuard>}>
            <Route path="/buildings/:pk/report" element={<ErrorBoundary><ReportPage /></ErrorBoundary>} />
            <Route path="/buildings/:pk/story" element={<ErrorBoundary><ReportStory /></ErrorBoundary>} />
            <Route path="/reports/:id" element={<ErrorBoundary><ReportPage /></ErrorBoundary>} />
            <Route path="/briefings/:id" element={<ErrorBoundary><BriefingPage /></ErrorBoundary>} />
            {/* 계약 문서(초안) — 모달이 아니라 새 탭. 종이는 크게 본다 */}
            <Route path="/deals/:pk/papers" element={<ErrorBoundary><DocPage /></ErrorBoundary>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
