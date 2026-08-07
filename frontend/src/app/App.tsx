import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthGuard } from "./AuthGuard";
import { Shell } from "./Shell";
import { refresh } from "../shared/api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { LandingPage } from "../features/landing/LandingPage";
import { GuidePage } from "../features/beta/GuidePage";
import { SurveyPage } from "../features/beta/SurveyPage";
import { OnboardingPage } from "../features/landing/OnboardingPage";
import { SearchPage } from "../features/search/SearchPage";
import { BuildingPage } from "../features/building/BuildingPage";
import { ReportPage } from "../features/building/ReportPage";
import { BriefingPage } from "../features/building/BriefingPage";
import { ReportStory } from "../features/building/ReportStory";
import { MyPage } from "../features/mypage/MyPage";
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
          <Route path="/welcome" element={<AuthGuard><OnboardingPage /></AuthGuard>} />
          <Route element={<AuthGuard><Shell /></AuthGuard>}>
            <Route path="/search" element={<ErrorBoundary><SearchPage /></ErrorBoundary>} />
            <Route path="/buildings/:pk" element={<ErrorBoundary><BuildingPage /></ErrorBoundary>} />
            <Route path="/mypage" element={<ErrorBoundary><MyPage /></ErrorBoundary>} />
          </Route>
          {/* 보고서 = 헤더 없는 전체화면(새 탭으로 여는 독립 뷰) */}
          <Route element={<AuthGuard><div style={{ height: "100vh", overflow: "hidden" }}><Outlet /></div></AuthGuard>}>
            <Route path="/buildings/:pk/report" element={<ErrorBoundary><ReportPage /></ErrorBoundary>} />
            <Route path="/buildings/:pk/story" element={<ErrorBoundary><ReportStory /></ErrorBoundary>} />
            <Route path="/reports/:id" element={<ErrorBoundary><ReportPage /></ErrorBoundary>} />
            <Route path="/briefings/:id" element={<ErrorBoundary><BriefingPage /></ErrorBoundary>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
