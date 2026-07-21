import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthGuard } from "./AuthGuard";
import { Shell } from "./Shell";
import { LoginPage } from "../features/auth/LoginPage";
import { SearchPage } from "../features/search/SearchPage";
import { BuildingPage } from "../features/building/BuildingPage";
import { MyPage } from "../features/mypage/MyPage";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } });

export function App() {
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
          <Route path="*" element={<Navigate to="/search" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
