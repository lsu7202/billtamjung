import { Icon } from "../../shared/ui/Icon";
import { AuthImg } from "../../shared/ui/AuthImg";
import { Avatar } from "./AdCards";

/** 올린 지 — 「19분 전」 · 「3시간 전」 · 「5일 전」(디스코식) */
export const ago = (t?: string | null) => {
  if (!t) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

/** 매물 카드(10-01) — 탐색 목록과 사이드바 아래 고정 줄이 같이 쓴다. 모양은 여기 한 곳.
 *  윗줄 = 중개사(사무소명 · 이름 · 직급 — 진하고 크게, 10-02 · 오른쪽 끝에 올린 지). 중개사가 없으면(광고 없는 건물) 윗줄째 안 선다.
 *  본문 = #용도 · 제목(없으면 주소) · 가격 · 면적 · 관심, 오른쪽 사진. children 은 카드 끝에 붙는다(같은 매물 · 숨기기).
 *  compact(10-02) = 사이드바 아래 고정 줄 — 같은 윗줄 + 한 줄(작은 사진 · 가격 · action). 높이를 반으로 */
export function ListingCard({ agent, agentPhoto, rank, office, when, tag, title, kind = "매매", price, sub, interest, photo, onClick, className = "", children, compact = false, action }: {
  agent?: string | null; /** 중개사 프로필 사진(0219) */ agentPhoto?: string | null;
  /** 직급(0206) — 모르면 안 붙인다 */ rank?: string | null; office?: string | null; when?: string;
  tag?: string; title: string;
  /** 가격 앞 낱말 — 매매(빨강) · 실거래 · 추정가(회색) */
  kind?: string; price: string;
  sub?: string; interest?: string | null; photo?: string | null;
  onClick?: () => void; className?: string; children?: React.ReactNode;
  compact?: boolean; /** compact 줄 오른쪽(문의하기 · 구해요) */ action?: React.ReactNode;
}) {
  const ph = <div className="lc-ph">{photo ? <AuthImg src={photo} /> : <Icon name="building" size={18} />}</div>;
  const pr = <div className="lc-t"><em className={kind === "매매" ? "" : "gray"}>{kind}</em><b className="num">{price}</b></div>;
  return (
    <div className={`lc ${compact ? "compact" : ""} ${className}`} onClick={onClick}>
      {agent !== undefined && (
        <div className="lc-top">
          <Avatar name={agent ?? office ?? "?"} photo={agentPhoto} />
          <b className="lc-who">{office && <span>{office}</span>}<span>{agent ?? "담당 미정"}{rank ? ` ${rank}` : ""}</span></b>
          <span className="lc-ago">{when ?? ""}</span>
        </div>
      )}
      {compact ? <div className="lc-mini">{ph}{pr}{action}</div> : <div className="lc-main">
        <div className="lc-b">
          <div className="lc-tag">{tag ?? ""}</div>
          <div className="lc-a">{title}</div>
          {pr}
          {sub && <div className="lc-s num">{sub}</div>}
          {interest && <div className="lc-int num">{interest}</div>}
        </div>
        {ph}
      </div>}
      {children}
    </div>
  );
}
