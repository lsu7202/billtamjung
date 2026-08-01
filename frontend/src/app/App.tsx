import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthGuard } from "./AuthGuard";
import { Shell } from "./Shell";
import { refresh } from "../shared/api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { SearchPage } from "../features/search/SearchPage";
import { BuildingPage } from "../features/building/BuildingPage";
import { ReportPage } from "../features/building/ReportPage";
import { ReportStory } from "../features/building/ReportStory";
import { MyPage } from "../features/mypage/MyPage";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

export function App() {
  // 세션 복원: 마운트 시 httpOnly refresh 쿠키로 access 재발급 시도(완료 전 라우팅 보류)
  const [booted, setBooted] = useState(false);
  useEffect(() => { refresh().finally(() => setBooted(true)); }, []);
  if (!booted) return null;

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard><Shell /></AuthGuard>}>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/buildings/:pk" element={<BuildingPage />} />
            <Route path="/mypage" element={<MyPage />} />
          </Route>
          {/* 보고서 = 헤더 없는 전체화면(새 탭으로 여는 독립 뷰) */}
          <Route element={<AuthGuard><div style={{ height: "100vh", overflow: "hidden" }}><Outlet /></div></AuthGuard>}>
            <Route path="/buildings/:pk/report" element={<ReportPage />} />
            <Route path="/buildings/:pk/story" element={<ReportStory />} />
            <Route path="/reports/:id" element={<ReportPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/search" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
