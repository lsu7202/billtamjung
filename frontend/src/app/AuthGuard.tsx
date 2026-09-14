import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../shared/store/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const access = useAuth((s) => s.access);
  const loc = useLocation();
  // 딥링크 복귀: 미인증으로 튕길 때 원래 목적지를 넘겨 로그인 후 복귀
  if (!access) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}
