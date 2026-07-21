import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

export function LoginPage() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", office_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const on = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res =
        tab === "login"
          ? await authApi.login({ email: form.email, password: form.password })
          : await authApi.signup(form);
      setAuth(res.access_token, res.tier);
      nav("/search");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22 }}>빌탐정</h1>
      <div style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <button onClick={() => setTab("login")} disabled={tab === "login"}>로그인</button>
        <button onClick={() => setTab("signup")} disabled={tab === "signup"}>회원가입</button>
      </div>
      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        {tab === "signup" && (
          <>
            <input placeholder="이름" value={form.name} onChange={on("name")} required />
            <input placeholder="중개사무소명(선택)" value={form.office_name} onChange={on("office_name")} />
          </>
        )}
        <input placeholder="이메일" type="email" value={form.email} onChange={on("email")} required />
        <input placeholder="비밀번호" type="password" value={form.password} onChange={on("password")} required />
        {err && <div style={{ color: "crimson", fontSize: 13 }}>{err}</div>}
        <button type="submit" disabled={busy}>
          {tab === "login" ? "로그인" : "가입하고 시작하기"}
        </button>
      </form>
    </div>
  );
}
