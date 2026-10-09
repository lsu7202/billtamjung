import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, customerApi, officeApi, teamApi } from "../../shared/api/endpoints";
import { shortAddr } from "../../shared/format";
import { Icon } from "../../shared/ui/Icon";
import { ago } from "../search/ListingCard";
import { AdCard, SectionHead, Shelf } from "./CustomerHome";
import { Face, MyFace } from "../../shared/ui/Face";
import { OfficeCells, ReceivedInvites } from "./OfficePage";
import "./customer.css";

/* ══════════════════════ 중개사 마이페이지(S09 · 2026-10-04) ══════════════════════
 *
 * 고객 마이페이지와 같은 프로필 결 — 머리(사람) · 내 중개사무소 · 관심 매물.
 * 사무소 정보와 팀은 같은 줄(app.teams)이라 한 묶음이다 — 위 정보 칸, 아래 사람 카드.
 * 묶음마다 따로 열 수 있다: /mypage/{office|saves|account}. 정보 고치기 · 상태 사전 · 초대 · 제외 · 승계는 /mypage/office.
 * 리포트(분석 · 브리핑)는 폐지돼 뺐다. 저장한 조건은 매물 탐색 조건 창 · 고객관리에서 본다 */

export const BROKER_SECTIONS: [string, string][] = [["office", "내 중개사무소"], ["saves", "관심 매물"], ["account", "계정"]];

export function BrokerProfilePage({ section, officeEdit, account }: {
  section?: string; officeEdit: React.ReactNode; account: React.ReactNode;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const office = useQuery({ queryKey: ["office"], queryFn: officeApi.get });
  const teamQ = useQuery({ queryKey: ["team"], queryFn: teamApi.get });
  const saves = useQuery({ queryKey: ["saves"], queryFn: customerApi.saves });
  const [showAcc, setShowAcc] = useState(false);
  const one = section && BROKER_SECTIONS.some(([k]) => k === section) ? section : null;
  const show = (k: string) => !one || one === k;
  const o = office.data;
  const name = me.data?.name ?? "";
  const photo = (ad: number | null, ph: number | null | undefined) => (ad && ph ? `/api/ads/${ad}/photos/${ph}` : null);
  const off = (st: string | null, expired: boolean | null | undefined) => (st === "노출" && !expired ? null : st === "거래완료" ? "거래완료" : "내려감");
  const members = teamQ.data?.members ?? [];

  return (
    <div className="cp">
      {one && <SectionHead title={BROKER_SECTIONS.find(([k]) => k === one)![1]}
        n={{ saves: saves.data?.length }[one]} />}
      {one === "account" && <div className="cp-acc mp">{account}</div>}
      {one === "office" && officeEdit}

      {!one && <header className="cp-head">
        <MyFace name={name} />
        <div className="cp-who">
          <h1>{name}</h1>
          <div className="cp-sub">{[me.data?.job_title, o?.office_name, me.data?.email].filter(Boolean).join(" · ")}</div>
          <div className="cp-acts">
            <button className={`cp-pill ${showAcc ? "on" : ""}`} onClick={() => setShowAcc(!showAcc)}><Icon name="settings" size={14} />계정</button>
          </div>
        </div>
      </header>}
      {!one && showAcc && <div className="cp-acc mp">{account}</div>}
      {!one && <ReceivedInvites />}

      {/* 내 중개사무소 — 위: 광고 아래 「중개사무소 정보」로 나가는 값 · 아래: 사람 카드. 고치기 · 초대 · 제외 · 승계는 묶음 화면 */}
      {!one && (
        <section className="cp-inv">
          <div className="cp-sh"><h3 className="link" onClick={() => nav("/mypage/office")}>내 중개사무소<Icon name="back" size={16} /></h3>
            <span className="sp" />
            {teamQ.data?.my_role === "owner" && <button className="cp-pill" onClick={() => nav("/mypage/office")}><Icon name="invite" size={14} />초대</button>}
            <button className="cp-pill" onClick={() => nav("/mypage/office")}><Icon name="edit" size={14} />고치기</button></div>
          <div className="cp-inv-box">
            <OfficeCells onOpen={() => nav("/mypage/office")} />
            <div className="cp-people in">
              {members.map((m) => (
                <div key={m.account_id} className="cp-person" onClick={() => nav("/mypage/office")}>
                  <Face name={m.name} photo={m.photo} className="cp-av sm" />
                  <b>{m.name}{m.role === "owner" && <i className="adm">관리자</i>}{m.is_me && <i>나</i>}</b>
                  <span>{m.job_title ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {show("saves") && <Shelf title="관심 매물" to="/mypage/saves" full={one === "saves"} n={(saves.data ?? []).length} empty="관심 매물이 없습니다">
        {(saves.data ?? []).map((r) => (
          <AdCard key={r.id} pnu={r.pnu} photo={photo(r.ad_id, r.photo_id)} addr={shortAddr(r.addr) || (r.ad_title ?? "")}
            price={r.ad_price} office={r.office_name ?? null} when={ago(r.created_at)} off={off(r.ad_state, r.ad_expired)}
            onX={async () => { await customerApi.unsave(r.id); qc.invalidateQueries({ queryKey: ["saves"] }); }} />
        ))}
      </Shelf>}
    </div>
  );
}
