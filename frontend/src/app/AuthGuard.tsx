import { Navigate } from "react-router-dom";
import { useAuth } from "../shared/store/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const access = useAuth((s) => s.access);
  if (!access) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
