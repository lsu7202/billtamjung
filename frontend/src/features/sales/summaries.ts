/** 사람 요약 — **찍힌 필드만 문장이 된다**(안 찍힌 건 침묵).
 *  매수자 카드(업무 탭)와 계약 창의 매수자 탭이 **같은 문장을 쓴다** — 같은 사람을
 *  두 화면에서 다르게 소개하면 어느 쪽이 맞나 헷갈린다(2026-08-19).
 */
import type { Buyer, BuyerCondition } from "../../shared/api/endpoints";

type RegionPick = { label?: string };
type Cond = { regions?: RegionPick[]; polygon?: object | null; filters?: Record<string, unknown> };

export function buyerSummary(b: Buyer): { text: string; thin: boolean } {
  const p: string[] = [];
  const ageBand = { "2030": "20·30대", "4050": "40·50대", "6070": "60·70대", "70이상": "70대 이상" }[b.age_band ?? ""];
  const sex = { "남": "남성", "여": "여성" }[b.gender ?? ""];
  const age = [ageBand, sex].filter(Boolean).join(" ");
  const src = { "소개": "소개로 연결된", "광고": "광고를 보고 온", "직접문의": "직접 문의해 온",
                "기존고객": "오래 본 기존 고객인" }[b.source ?? ""];
  const head = [age, src].filter(Boolean).join(" ");
  const who = b.is_corp ? "법인" : "매수자";
  p.push(head ? `${head} ${who}` : who);
  const g = { A: "매수 의지가 확실합니다", B: "무난히 진행 중입니다", C: "시세를 관망하는 쪽입니다" }[b.grade ?? ""];
  if (g) p.push(g);
  const co = b.cooperation === "협조적" ? "협조적이고" : b.cooperation === "비협조적" ? "연락은 조심스럽게 —" : "";
  const ki = b.kindness === "친절" ? "응대가 부드럽습니다" : b.kindness === "불친절" ? "응대가 까다로운 편입니다" : "";
  if (co || ki) p.push([co, ki].filter(Boolean).join(" ") || co.replace(/이고$/, "적입니다"));
  let text = p[0] + (p.length > 1 ? " — " + p.slice(1).join(". ") : "") + ".";
  if (b.activity === "휴면") text = "(휴면 — 오래 조용합니다) " + text;
  const thin = !age && !src && !b.grade && !b.cooperation && !b.kindness;
  return { text, thin };
}

/* 조건 요약 — conditions_json을 사람 말로. 중요한 것만: 지역·가격대·면적·수익률·엘리베이터·역세권·연식. */
export function condSummary(c: BuyerCondition): string {
  const j = (c.conditions_json ?? {}) as Cond;
  const f = (j.filters ?? {}) as Record<string, unknown>;
  const num = (k: string) => (f[k] != null && f[k] !== "" ? Number(f[k]) : null);
  const eokR = (lo: number | null, hi: number | null) =>
    lo != null && hi != null ? `${lo / 1e8}~${hi / 1e8}억`
    : lo != null ? `${lo / 1e8}억 이상` : hi != null ? `${hi / 1e8}억 이하` : null;
  const pyR = (k: string, label: string) => {
    const lo = num(`${k}_min`), hi = num(`${k}_max`);
    const py = (v: number) => Math.round(v / 3.305785);
    return lo != null && hi != null ? `${label} ${py(lo)}~${py(hi)}평`
      : lo != null ? `${label} ${py(lo)}평↑` : hi != null ? `${label} ${py(hi)}평↓` : null;
  };
  const parts: (string | null)[] = [
    (j.regions ?? []).map((r) => r.label ?? (r as unknown as { name?: string }).name).filter(Boolean).join("·") || null,
    j.polygon ? "그린 영역" : null,
    eokR(num("price_min"), num("price_max")),
    pyR("land_area", "대지"),
    pyR("total_area", "연"),
    num("roi_min") != null ? `수익률 ${num("roi_min")}%↑` : null,
    num("elevator_min") != null && num("elevator_min")! >= 1 ? "엘리베이터" : null,
    num("station_dist_max") != null ? `역 ${num("station_dist_max")}m 내` : null,
    num("age_max") != null ? `연식 ${num("age_max")}년↓` : null,
    num("floors_above_min") != null ? `${num("floors_above_min")}층↑` : null,
    (f.use_zones as string[] | undefined)?.length ? (f.use_zones as string[]).slice(0, 2).join("·") : null,
  ];
  const shown = parts.filter(Boolean) as string[];
  const used = new Set(["price_min", "price_max", "roi_min", "land_area_min", "land_area_max",
    "total_area_min", "total_area_max", "use_zones", "bjd_code",
    "elevator_min", "station_dist_max", "age_max", "floors_above_min"]);
  const rest = Object.keys(f).filter((k) => f[k] != null && f[k] !== "" && !used.has(k)).length;
  return (shown.join(" · ") || "조건 없음") + (rest > 0 ? ` · +${rest}개 조건` : "");
}
