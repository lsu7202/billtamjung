import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "../api/endpoints";
import { BASE } from "../api/client";
import { useAuth } from "../store/auth";
import { Icon } from "./Icon";
import "./face.css";

/* 프로필 사진(0219) — 사진이 있으면 사진, 없으면 이름 첫 글자 동그라미.
 * 중개사 사진은 주소(/api/auth/photo/{id})로 바로 열린다(매물 카드 · 팀 카드).
 * 본인 사진은 고객일 수도 있어 토큰을 실어 받는다(useMyPhoto) — 고객 사진은 주소로 안 열린다. */

/** 동그라미 하나 — className 으로 크기를 정한다(cp-av · cp-av sm · adf-av · srail-me) */
export function Face({ name, photo, className }: { name: string; photo?: string | null; className: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [photo]);
  return (
    <span className={`${className} face`}>
      {photo && !bad ? <img src={photo} alt="" onError={() => setBad(true)} /> : name.trim().slice(0, 1)}
    </span>
  );
}

/** 본인 사진 — me.photo 가 바뀔 때만 다시 받는다 */
export function useMyPhoto(): string | null {
  const access = useAuth((s) => s.access);
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me, enabled: !!access });
  const v = me.data?.photo ?? null;
  const q = useQuery({
    queryKey: ["myPhoto", v], enabled: !!v && !!access, staleTime: Infinity,
    queryFn: async () => {
      const r = await fetch(`${BASE}/auth/me/photo`, { headers: { Authorization: `Bearer ${useAuth.getState().access}` }, credentials: "include" });
      return r.ok ? URL.createObjectURL(await r.blob()) : null;
    },
  });
  return v ? q.data ?? null : null;
}

/** 프로필 머리의 큰 동그라미 — 누르면 사진 고르기. 사진이 있으면 올렸을 때 바꾸기 · 지우기 */
export function MyFace({ name, className = "cp-av" }: { name: string; className?: string }) {
  const qc = useQueryClient();
  const photo = useMyPhoto();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const done = () => { setBusy(false); qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["team"] }); };
  const up = (f: File) => { setBusy(true); authApi.uploadPhoto(f).then(done, (e) => { setBusy(false); alert((e as Error).message); }); };
  const del = () => { setBusy(true); authApi.deletePhoto().then(done, () => setBusy(false)); };
  return (
    <span className={`myface ${busy ? "busy" : ""}`}>
      <button className="myface-b" title={photo ? "사진 바꾸기" : "사진 올리기"} onClick={() => ref.current?.click()}>
        <Face name={name} photo={photo} className={className} />
        <i className="myface-cam"><Icon name="edit" size={16} /></i>
      </button>
      {photo && <button className="myface-x" title="사진 지우기" onClick={del}><Icon name="trash" size={14} /></button>}
      <input ref={ref} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) up(f); e.target.value = ""; }} />
    </span>
  );
}
