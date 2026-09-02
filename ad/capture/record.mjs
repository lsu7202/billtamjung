/* 가이드 영상 화면 녹화 — 프로덕션을 실제로 조작한다.
 *
 *   node record.mjs 1      # 퀘스트 1만
 *   node record.mjs 1 2 3  # 전부
 *
 * 각 퀘스트는 세 박자로 간다: ① 제시(정지) ② 방법(예고 상자만) ③ 실연(실제 조작).
 * 조작 시각은 out/q<N>.json 에 남겨서, 편집에서 나레이션·확대·퀘스트 띠를 정확히 맞춘다.
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { CURSOR, ensureCursor, moveTo, clickBox, timeline } from "./lib.mjs";

const BASE = "https://billtamjung.web.app";
const EMAIL = "demo@billtamjung.app";
const PW = "btdemo2026!";
const OUT = "out";
const want = process.argv.slice(2).length ? process.argv.slice(2) : ["1"];

const rect = (page, sel, nth = 0) => page.evaluate(([s, n]) => {
  const el = document.querySelectorAll(s)[n];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, [sel, nth]);

const rectText = (page, text, sel = "button") => page.evaluate(([t, s]) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, [text, sel]);

/** 조건 묶음 선택 버튼(`button.sec-chk`) — 행 전체를 누르면 펼침 화살표(`.sec-exp`)가 먹혀 선택이 안 된다 */
const rectSector = (page, text) => page.evaluate((t) => {
  const el = [...document.querySelectorAll("button.sec-chk")].find((b) => b.textContent.trim().startsWith(t));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, text);

/** 적용 후 조건 칩이 실제로 붙었는지 — 모달이 닫힌 뒤에 본다(열려 있으면 글자만 보고 통과한다) */
async function expectChips(page, texts) {
  const have = await page.evaluate(() =>
    [...document.querySelectorAll(".chip")].map((c) => c.textContent.trim()).join(" | "));
  for (const t of texts) console.log(have.includes(t) ? `  ✓ ${t}` : `  ✗ 안 걸림: ${t}`);
  console.log("  칩:", have || "(없음)");
}

/** 예고 상자만 띄운다 — ② 방법 박자에서 쓴다(누르지 않는다) */
async function point(page, box, T, label, ms = 1800, pad = 9) {
  await page.evaluate((r) => window.__btBox(r), { ...box, pad });
  T.mark("point", label, box);
  await moveTo(page, box.cx, box.cy - box.h - 26, { steps: 22 });
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__btBox(null));
  await page.waitForTimeout(220);
}

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="password"]', { timeout: 30000 });
  await page.fill('input[type="email"], input[placeholder*="이메일"]', EMAIL);
  await page.fill('input[type="password"]', PW);
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/(search|welcome)/, { timeout: 30000 });
  if (page.url().includes("/welcome")) await page.goto(`${BASE}/search`);
  await page.waitForSelector("button.tool-btn", { timeout: 30000 });
  await ensureCursor(page);
  await page.waitForTimeout(3500);            // 지도 타일이 다 뜰 때까지 — 회색 타일이 찍히면 못 쓴다
  return page;
}

async function newCtx(name) {
  const browser = await chromium.launch({ headless: true });
  // 시계는 여기서 켠다. 로그인 뒤에 켜면 녹화 시작 시각과 어긋나(약 13초) 편집이 통째로 밀린다.
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: `${OUT}/${name}`, size: { width: 1920, height: 1080 } },
  });
  await ctx.addInitScript(CURSOR);
  return { browser, ctx };
}


/** 슬라이더 하한을 직접입력으로 넣는다 — 드래그보다 확실하고 값이 정확하다 */
async function setMin(page, chipLabel, value) {
  const chip = await rectText(page, chipLabel, "span.vchip");
  if (!chip) return false;
  await page.mouse.move(chip.cx, chip.cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(500);
  const io = await rect(page, ".rs-io");
  if (io) { await page.mouse.move(io.cx, io.cy); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(350); }
  const lo = await rect(page, ".lo-g input");
  if (!lo) return false;
  await page.mouse.move(lo.cx, lo.cy); await page.mouse.down(); await page.mouse.up();
  await page.keyboard.type(String(value), { delay: 60 });
  await page.waitForTimeout(400);
  await closePopover(page);
  return true;
}

async function closePopover(page) {
  await page.evaluate(() => {
    const back = [...document.querySelectorAll("div")].find((d) =>
      d.children.length === 0 && getComputedStyle(d).position === "fixed" && d.getBoundingClientRect().width > 1000);
    back?.click();
  });
  await page.waitForTimeout(350);
}

/** 촬영 전에 미리 걸어두는 조건 — 고르는 과정은 길어서 영상에 안 담는다(설명만 한다) */
async function preset(page) {
  await page.locator('button:has-text("필터")').first().click();
  await page.waitForTimeout(900);

  // 주용도 8종
  await page.locator('.idx-item:has-text("건물정보")').click();
  await page.waitForTimeout(600);
  const chip = await rectText(page, "주용도", "span.vchip");
  await page.mouse.move(chip.cx, chip.cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(700);
  for (const u of ["제1종근린생활시설", "제2종근린생활시설", "판매시설", "의료시설",
                   "교육연구시설", "노유자시설", "운동시설", "업무시설"]) {
    const b = await rectText(page, u, "button");
    if (!b) { console.log("  ? 주용도 못 찾음:", u); continue; }
    await page.mouse.move(b.cx, b.cy); await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(150);
  }
  await closePopover(page);

  await setMin(page, "대지면적", 40);      // 평
  await setMin(page, "연면적", 100);       // 평

  const apply = await rectText(page, "적용");
  await page.mouse.move(apply.cx, apply.cy); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(5000);
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".chip")].map((c) => c.textContent.trim()).join(" | "));
  console.log("  사전 조건:", chips || "(없음)");
}


/** 대상 요소를 화면 가운데로 올린 뒤 좌표를 잰다 — 스크롤이 끝난 뒤 재야 어긋나지 않는다 */
async function rectAfterScroll(page, fn) {
  await page.evaluate(fn);
  await page.waitForTimeout(600);
  return page.evaluate(fn);
}

/** 섹션 제목을 화면 가운데로 올리고 좌표를 준다 — 표·수치를 읽을 수 있게 */
async function toSection(page, title, T, label) {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll(".sec-head")].find((e) => e.textContent.trim().startsWith(t));
    if (!el) return null;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    const card = el.closest("div");
    const r = (card || el).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 520), cx: r.x + r.width / 2, cy: r.y + 60 };
  }, title);
  if (!box) { console.log("  ? 섹션 없음:", title); return null; }
  await page.waitForTimeout(700);
  await page.evaluate((r) => window.__btBox(r), { ...box, pad: 8 });
  T.mark("sec", label ?? title, box);
  await moveTo(page, box.cx, box.cy, { steps: 18 });
  return box;
}


/** 사진 정렬 버그(ORDER BY kind 가 텍스트 정렬) 때문에 건축물대장이 있으면 리포트 표지에 그게 박힌다.
 *  브리핑에는 대장이 필요하고 리포트 표지에는 없어야 하므로, 촬영 중간에 뗀다.
 *  (정식 수정은 로컬에 있으나 영업 미배포라 프로덕션에 못 올린다) */
async function ledger(action) {
  const login = await fetch(`${BASE.replace("billtamjung.web.app", "bt-api-qrh5sd5skq-du.a.run.app")}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PW }),
  }).then((r) => r.json());
  const H = { Authorization: `Bearer ${login.access_token}` };
  const api = "https://bt-api-qrh5sd5skq-du.a.run.app/api/buildings/1003114306/photos";
  const list = await fetch(api, { headers: H }).then((r) => r.json());
  if (action === "off") {
    for (const x of list.filter((y) => y.kind === "building_ledger")) {
      await fetch(`${api}/${x.id}`, { method: "DELETE", headers: H });
    }
    console.log("  건축물대장 뗌(리포트 표지용)");
  }
}

/* ───────────────────────── 퀘스트 1 · 사대문 안쪽 40~60억 매물 찾기 ───────────────────────── */
async function quest1() {
  const { browser, ctx } = await newCtx("q1");
  const T = timeline();                          // 녹화 시작 = 시계 0초
  const page = await login(ctx);
  T.mark("ready", "로그인 완료");

  // 주용도·대지면적·연면적은 고르는 데 오래 걸린다 — 미리 걸어두고 화면으로만 설명한다
  await preset(page);
  T.mark("ready", "사전 조건 완료");

  // 지도를 사대문으로 — 검색어를 한 글자씩(사람처럼)
  const q = page.locator('input[placeholder*="주소 또는 지명"]');
  await moveTo(page, 250, 95);
  await q.click();
  for (const ch of "종로3가역") await q.type(ch, { delay: 110 });
  await page.waitForTimeout(1100);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3200);
  // 휠 1번 — 2번은 너무 넓어져 영역 검색이 느려지고 사대문이 작아진다
  await page.mouse.move(1150, 640);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(900);
  await page.waitForTimeout(2600);
  T.mark("ready", "지도 준비");

  // 사대문 — 실제 위경도로 그린다. 지도를 두 곳 눌러 얻은 좌표로 변환식을 만든다.
  const CORNERS = [[37.5748, 126.9672], [37.5766, 126.9706], [37.5764, 126.9792], [37.577, 126.986], [37.5778, 126.9932], [37.5792, 126.9996], [37.5726, 127.0074], [37.5688, 127.0082], [37.5658, 127.0072], [37.5634, 127.0034], [37.5612, 126.9944], [37.5604, 126.9858], [37.5588, 126.9786], [37.5598, 126.9752], [37.5646, 126.967], [37.5698, 126.9648], [37.5748, 126.9672]];
  const hits = [];
  page.on("request", (r) => {
    const m = r.url().match(/parcel-at\?lng=([\d.-]+)&lat=([\d.-]+)/);
    if (m) hits.push({ lng: +m[1], lat: +m[2] });
  });
  const CAL = [[900, 500], [1500, 850]];
  for (const [x, y] of CAL) {
    await moveTo(page, x, y, { steps: 6 });
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(2000);
  }
  if (hits.length < 2) throw new Error("좌표 보정 실패");
  const [CA, CB] = hits;
  const sx = (CAL[1][0] - CAL[0][0]) / (CB.lng - CA.lng);
  const sy = (CAL[1][1] - CAL[0][1]) / (CB.lat - CA.lat);
  const toXY = (lat, lng) => [CAL[0][0] + (lng - CA.lng) * sx, CAL[0][1] + (lat - CA.lat) * sy];



  // ① 제시 — 화면 멈추고 퀘스트만 보여줄 구간
  await page.waitForTimeout(2600);
  T.mark("beat", "제시 끝");

  // ② 방법 — 누를 자리만 짚는다
  const freeBtn = await page.evaluate(() => {
    const el = [...document.querySelectorAll("button.tool-btn")].find((b) => (b.title || "").includes("자유곡선"));
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
  await point(page, freeBtn, T, "자유곡선 자리", 5600, 18);
  const filterBtn = await rectText(page, "필터");
  await point(page, filterBtn, T, "필터 자리", 5600);
  T.mark("beat", "방법 끝");

  // ③ 실연
  await clickBox(page, freeBtn, T, "자유곡선 켜기", { hold: 1100, pad: 18 });
  await page.waitForTimeout(1400);

  // 사대문을 감싸 그린다 — 가속·감속을 준다(등속이면 기계로 보인다)
  const map = await page.evaluate(() => {
    const r = document.querySelector("main").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // 좌표 변환식(toXY)은 위에서 미리 만들어 둔다
  const pts = [];
  for (let i = 0; i < CORNERS.length - 1; i++) {
    const [alat, alng] = CORNERS[i], [blat, blng] = CORNERS[i + 1];
    for (let k = 0; k < 6; k++) {
      const t = k / 6;
      pts.push(toXY(alat + (blat - alat) * t, alng + (blng - alng) * t));
    }
  }
  pts.push(toXY(...CORNERS[0]));
  await moveTo(page, pts[0][0], pts[0][1], { steps: 28 });
  await page.waitForTimeout(2600);              // 시작점에서 한 박자 — 나레이션이 들어갈 자리
  T.mark("draw", "그리기 시작");
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    const t = i / pts.length;
    const slow = t < 0.15 || t > 0.85;          // 시작·끝을 더 천천히
    await page.mouse.move(pts[i][0], pts[i][1], { steps: slow ? 6 : 3 });
    await page.waitForTimeout(slow ? 55 : 32);  // 6초 안팎 — 나레이션이 들어갈 자리를 만든다
  }
  await page.waitForTimeout(500);
  await page.mouse.up();
  T.mark("draw", "그리기 끝");
  await page.waitForTimeout(10000);             // 영역 검색은 느리다 — 결과가 실제로 바뀔 때까지 기다린다

  // 필터 — 매매가 40~60억
  await clickBox(page, await rectText(page, "필터"), T, "필터 열기");
  await page.waitForTimeout(1100);
  await clickBox(page, await rectText(page, "매매가", "span.vchip"), T, "매매가");
  await page.waitForTimeout(800);
  const io = await rect(page, ".rs-io");
  await clickBox(page, io, T, "직접 입력 열기", { hold: 420 });
  await page.waitForTimeout(500);
  const lo = await rect(page, ".lo-g input");
  await moveTo(page, lo.cx, lo.cy); await page.mouse.down(); await page.mouse.up();
  await page.keyboard.type("40", { delay: 190 });
  T.mark("type", "40억");
  await page.waitForTimeout(700);
  const hi = await rect(page, ".hi-g input");
  await moveTo(page, hi.cx, hi.cy); await page.mouse.down(); await page.mouse.up();
  await page.keyboard.type("60", { delay: 190 });
  T.mark("type", "60억");
  await page.waitForTimeout(1400);

  // 입지정보 · 역과의거리 300m 이내 — 역세권으로 좁힌다
  await page.evaluate(() => {
    const back = [...document.querySelectorAll("div")].find((d) =>
      d.children.length === 0 && getComputedStyle(d).position === "fixed" && d.getBoundingClientRect().width > 1000);
    back?.click();
  });
  await page.waitForTimeout(500);
  await clickBox(page, await rectText(page, "입지정보", ".idx-item"), T, "입지정보");
  await page.waitForTimeout(700);
  await clickBox(page, await rectText(page, "역과의거리", "span.vchip"), T, "역과의거리");
  await page.waitForTimeout(900);
  {
    const io2 = await rect(page, ".rs-io");
    if (io2) { await clickBox(page, io2, T, "직접 입력 열기", { hold: 420 }); await page.waitForTimeout(500); }
    const hi2 = await rect(page, ".hi-g input");
    if (hi2) {
      await moveTo(page, hi2.cx, hi2.cy); await page.mouse.down(); await page.mouse.up();
      await page.keyboard.type("300", { delay: 170 });
      T.mark("type", "역 300m");
    }
  }
  await page.waitForTimeout(1400);

  // 건물정보 · 엘리베이터 1대 이상
  await closePopover(page);
  await clickBox(page, await rectText(page, "건물정보", ".idx-item"), T, "건물정보");
  await page.waitForTimeout(700);
  await clickBox(page, await rectText(page, "엘리베이터", "span.vchip"), T, "엘리베이터");
  await page.waitForTimeout(900);
  {
    const io3 = await rect(page, ".rs-io");
    if (io3) { await clickBox(page, io3, T, "직접 입력 열기", { hold: 420 }); await page.waitForTimeout(450); }
    const lo3 = await rect(page, ".lo-g input");
    if (lo3) {
      await moveTo(page, lo3.cx, lo3.cy); await page.mouse.down(); await page.mouse.up();
      await page.keyboard.type("1", { delay: 200 });
      T.mark("type", "엘리베이터 1대");
    }
  }
  await page.waitForTimeout(1300);

  // 적용
  await page.evaluate(() => {
    const back = [...document.querySelectorAll("div")].find((d) =>
      d.children.length === 0 && getComputedStyle(d).position === "fixed" && d.getBoundingClientRect().width > 1000);
    back?.click();
  });
  await page.waitForTimeout(600);
  await clickBox(page, await rectText(page, "적용"), T, "적용");
  await page.waitForTimeout(8000);              // 조건 적용 결과가 뜰 때까지
  await expectChips(page, ["그린 영역", "매매가", "역", "엘리베이터", "주용도", "대지면적", "연면적"]);
  T.mark("done", "퀘스트 1 완료");

  // ── 이어서 퀘스트 2 · 3 — 방금 걸러진 목록에서 고른다(그래야 이야기가 이어진다) ──
  await page.waitForSelector(".ml-row, .wf-row", { timeout: 40000 });
  await page.waitForTimeout(2400);
  T.mark("beat", "Q2 제시 끝");

  // 지도 화면을 충분히 보여준다 — 내 매물이 파란 라벨로 구분되는 걸 담는다
  await page.waitForTimeout(5000);
  T.mark("beat", "지도 내 매물");
  await page.screenshot({ path: `${OUT}/all-map-mine.png` });

  const pkPath = "/buildings/1003114306";        // 중구 초동 53-5 · 내 매물 · 55.7억 · 수익률 2.99%
  // 지도의 매물 태그를 직접 클릭한다.
  // 핀은 캔버스라 DOM으로 못 집는다 — 앞서 만든 좌표 변환식(toXY)으로 그 지점을 누른다.
  {
    const target = await page.evaluate(async () => {
      const r = await fetch("/api/search/pins", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: { building_pk: "1003114306" } }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d[0] ? { lat: d[0].lat, lng: d[0].lng } : null;
    });
    const pin = target ? toXY(target.lat, target.lng) : null;
    console.log("  지도 태그 좌표:", pin ? pin.map(Math.round) : "못 구함");
    if (pin) {
      // 태그는 핀 위쪽에 붙는다 — 라벨 중심을 겨눈다
      const box = { x: pin[0] - 34, y: pin[1] - 40, w: 68, h: 26,
                    cx: pin[0], cy: pin[1] - 27 };
      await clickBox(page, box, T, "지도에서 초동 53-5", { hold: 1100, pad: 12 });
      await page.waitForTimeout(3400);
      T.mark("beat", "선택 카드");
      const det = (await rect(page, ".sel-detail")) ?? (await rectText(page, "상세보기"));
      if (det) {
        const [tab] = await Promise.all([
          ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null),
          clickBox(page, det, T, "상세보기", { hold: 900 }),
        ]);
        await page.waitForTimeout(1200);
        if (tab) { const u = tab.url(); await tab.close(); await page.goto(u); }
      }
    }
    if (!/\/buildings\//.test(page.url())) {
      console.log("  상세 진입 실패 — 주소로 이동");
      await page.goto(`${BASE}${pkPath}`);
    }
  }
  await page.waitForSelector("text=매물 분석하기", { timeout: 30000 });
  await page.waitForTimeout(2600);
  T.mark("beat", "상세 진입");

  // 업무탭 — 소유자 정보. 내 매물이면 바로 연락처까지 보인다는 걸 보여준다.
  {
    const tab = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "업무");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    if (tab) { await clickBox(page, tab, T, "업무탭"); await page.waitForTimeout(1200); }
    await page.waitForTimeout(5200);              // 소유자 정보를 읽을 시간(정지 컷으로 뽑는다)
    T.mark("beat", "소유자 정보");
    await page.screenshot({ path: `${OUT}/all-owner.png` });
  }

  // ── 퀘스트 2 · 빌탐정 추정치 리뷰 — 리포트 요약 → 전체 순서로 본다 ──
  {
    const rep = await rectText(page, "리포트 요약");
    if (rep) { await clickBox(page, rep, T, "리포트 요약"); await page.waitForTimeout(3000); }
    T.mark("beat", "리포트 요약");
    // 요약 안의 블록을 하나씩 짚는다 — 눌러만 두고 지나가면 아무것도 전달되지 않는다
    for (const [label, hold] of [["빌탐정 적정가", 6500], ["가격 비교", 6500], ["수익률 vs 주변", 6000]]) {
      const box = await page.evaluate((t) => {
        const el = [...document.querySelectorAll("div")].find((e) =>
          e.children.length <= 2 && (e.textContent || "").trim().startsWith(t));
        if (!el) return null;
        const card = el.parentElement || el;
        card.scrollIntoView({ behavior: "instant", block: "center" });
        const r = card.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 460), cx: r.x + r.width / 2, cy: r.y + 50 };
      }, label);
      if (!box) { console.log("  ? 요약 블록 없음:", label); continue; }
      await page.waitForTimeout(500);
      await page.evaluate((r) => window.__btBox(r), { ...box, pad: 8 });
      T.mark("sec", `요약 ${label}`, box);
      await moveTo(page, box.cx, box.cy, { steps: 16 });
      await page.waitForTimeout(hold);
      await page.evaluate(() => window.__btBox(null));
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${OUT}/all-report-summary.png` });

    // 페이지는 내부 div가 스크롤된다 — window.scrollTo로는 안 올라간다. 버튼을 직접 끌어온다.
    // ("전체 되돌리기"와 헷갈리면 안 되므로 글자가 정확히 "전체"인 것만)
    const all = await page.evaluate(() => {
      const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "전체");
      if (!el) return null;
      el.scrollIntoView({ behavior: "instant", block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    await page.waitForTimeout(700);
    console.log("  전체 버튼:", all ? "찾음" : "못 찾음");
    if (all) { await clickBox(page, all, T, "전체 보기"); await page.waitForTimeout(3500); }
    console.log("  진단:", JSON.stringify(await page.evaluate(() => ({
      url: location.pathname,
      scopeOn: [...document.querySelectorAll("button")].filter((b) => b.className.includes("primary"))
        .map((b) => b.textContent.trim()).slice(0, 4),
      secs: [...document.querySelectorAll(".sec-head")].length,
      panels: document.querySelectorAll(".panel").length,
      body: document.body.innerText.slice(0, 120).replace(/\s+/g, " "),
    }))));

    for (const [title, hold] of [["금액정보", 6500], ["층별 임대정보", 8000],
                                 ["주변 임대시세", 8000], ["주변 실거래", 8000], ["공시지가", 6500]]) {
      const box = await toSection(page, title, T, title);
      if (!box) continue;
      await page.waitForTimeout(hold);
      await page.evaluate(() => window.__btBox(null));
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${OUT}/all-estimates.png` });
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await page.waitForTimeout(1500);
    T.mark("done", "퀘스트 2 완료");
  }

  // ── 퀘스트 3 · 자료 만들기 — 브리핑과 리포트 둘 다, 마지막에 발표 ──
  // 「내가 입력한 값으로 자동 생성된다」가 이 장의 핵심이다.

  // (1) 브리핑 자료 — 사진·서류가 그대로 들어간다
  await point(page, await rectText(page, "브리핑 자료"), T, "브리핑 자료 자리", 2100);
  await clickBox(page, await rectText(page, "브리핑 자료"), T, "브리핑 자료");
  await page.waitForTimeout(2800);
  {
    // 중개인 코멘트 — 자동 생성 자료에 내 말이 그대로 들어간다는 걸 보여준다
    const ta = await rect(page, "textarea");
    if (ta) {
      await clickBox(page, ta, T, "중개인 코멘트", { hold: 500 });
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(400);
      for (const line of ["충무로역 도보 3분 · 대로변 코너",
                          "소유자 매도 의사 확고"]) {
        await page.keyboard.type(line, { delay: 42 });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
      T.mark("type", "중개인 코멘트");
      await page.waitForTimeout(2200);
    }
    const make = await rectText(page, "만들기");
    if (make) await clickBox(page, make, T, "만들기");
  }
  T.mark("gen", "브리핑 생성 시작");
  await page.waitForSelector("text=/1\\s*\\/\\s*7/", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  T.mark("gen", "브리핑 생성 끝");
  await page.screenshot({ path: `${OUT}/all-briefing.png` });
  for (const [no, label] of [["02", "건물 개요 · 중개인 코멘트"], ["04", "입체 지적도"],
                             ["06", "층별 임대정보"], ["07", "건물 사진"]]) {
    const th = await page.evaluate((n) => {
      const el = [...document.querySelectorAll(".deck-thumb")].find((e) => e.textContent.trim().startsWith(n));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }, no);
    if (!th) continue;
    await clickBox(page, th, T, `브리핑 ${label}`, { hold: 380 });
    await page.waitForTimeout(3600);
    T.mark("slide", `브리핑 ${label}`);
  }

  // (2) 빌탐정 리포트 — 표지에 서류가 박히지 않게 대장을 뗀다
  await ledger("off");
  await page.goto(`${BASE}${pkPath}`);
  await page.waitForSelector("text=매물 분석하기", { timeout: 30000 });
  await page.waitForTimeout(2600);
  await point(page, await rectText(page, "매물 분석하기"), T, "매물 분석하기 자리", 2000);
  await clickBox(page, await rectText(page, "매물 분석하기"), T, "매물 분석하기");
  await page.waitForTimeout(3500);
  {
    const confirm = await rectText(page, "생성 확정");
    if (confirm) await clickBox(page, confirm, T, "생성 확정");
  }
  T.mark("gen", "리포트 생성 시작");
  await page.waitForSelector("text=/\\d+\\s*\\/\\s*\\d+/", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(5000);
  T.mark("gen", "리포트 생성 끝");
  await page.screenshot({ path: `${OUT}/all-report.png` });

  // (3) 발표 — 애니메이션 모드에서 방향키로 한 장씩
  {
    const anim = await rectText(page, "애니메이션 모드");
    if (anim) {
      await page.evaluate((r) => window.__btBox(r), { ...anim, pad: 10 });
      T.mark("box", "애니메이션 모드", anim);
      await moveTo(page, anim.cx, anim.cy);
      await page.waitForTimeout(900);
      T.mark("click", "애니메이션 모드", anim);
      await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up();
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__btBox(null));
    }
    // 전체화면을 거치면 녹화 크기와 어긋나 1/4만 그려진다 — 주소로 바로 연다
    await page.goto(`${BASE}${pkPath}/story`);
    await page.waitForTimeout(5000);
    T.mark("beat", "발표 시작");
    await page.screenshot({ path: `${OUT}/all-anim.png` });

    const RAIL = ["핵심요약", "기본정보", "매력도", "실거래", "공시지가", "임대수익", "투자유형", "미래가치", "종합결론"];
    const STAY = { 실거래: 6500, 공시지가: 6500, 임대수익: 7500, 미래가치: 6000, 종합결론: 6000 };
    for (const name of RAIL) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(STAY[name] ?? 3000);
      T.mark("story", name);
    }
    await page.screenshot({ path: `${OUT}/all-anim-last.png` });
  }
  await page.waitForTimeout(2500);
  T.mark("done", "퀘스트 3 완료");

  const video = page.video();
  await ctx.close();
  await browser.close();
  fs.writeFileSync(`${OUT}/all.json`, JSON.stringify(T.rows, null, 1));
  console.log("영상:", await video.path());
  console.log("타임라인:", T.rows.length, "개");
}


/* ───────────────────────── 퀘스트 2 · 적정가 알아보기 ───────────────────────── */
async function quest2() {
  const { browser, ctx } = await newCtx("q2");
  const page = await login(ctx);
  const T = timeline();

  // 검색으로 매물 하나를 연다 — 지역 필터보다 확실하고, 대본의 "하나를 골라"와도 맞는다
  const q = page.locator('input[placeholder*="주소 또는 지명"]');
  await moveTo(page, 250, 95);
  await q.click();
  for (const ch of "종로5가 70") await q.type(ch, { delay: 105 });
  await page.waitForTimeout(1500);
  T.mark("ready", "검색어 입력");

  // ① 제시
  await page.waitForTimeout(2200);
  T.mark("beat", "제시 끝");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(4000);
  T.mark("pick", "매물 선택");

  // 선택 카드의 「상세보기 →」
  await page.waitForSelector(".sel-detail", { timeout: 30000 });
  await clickBox(page, await rect(page, ".sel-detail"), T, "상세보기");
  await page.waitForTimeout(3000);
  const pages = ctx.pages();
  if (pages.length > 1) {
    const url = pages[pages.length - 1].url();
    for (const x of pages.slice(1)) await x.close();
    await page.goto(url);
  }
  await page.waitForSelector("text=매물 분석하기", { timeout: 30000 });
  await page.waitForTimeout(3000);
  T.mark("beat", "상세 진입");

  // ② 방법 — 버튼 자리만 짚는다
  const analyze = await rectText(page, "매물 분석하기");
  await point(page, analyze, T, "매물 분석하기 자리", 2200);
  T.mark("beat", "방법 끝");

  // ③ 실연
  await clickBox(page, await rectText(page, "매물 분석하기"), T, "매물 분석하기");
  await page.waitForTimeout(3500);
  const confirm = await rectText(page, "생성 확정");
  if (confirm) await clickBox(page, confirm, T, "생성 확정");
  T.mark("gen", "생성 시작");
  await page.waitForTimeout(45000);              // 리포트 생성 — 편집에서 빨리감기로 줄인다
  T.mark("gen", "생성 끝");
  await page.screenshot({ path: `${OUT}/q2-after-gen.png` });
  await page.waitForTimeout(4000);
  T.mark("done", "퀘스트 2 완료");

  const video = page.video();
  await ctx.close(); await browser.close();
  fs.writeFileSync(`${OUT}/q2.json`, JSON.stringify(T.rows, null, 1));
  console.log("q2 영상:", await video.path());
}

/* ───────────────────────── 퀘스트 3 · 매수자 설명 자료 만들기 ───────────────────────── */
async function quest3(pkPath) {
  const { browser, ctx } = await newCtx("q3");
  const page = await login(ctx);
  const T = timeline();

  await page.goto(`${BASE}${pkPath}`);
  await page.waitForSelector("text=브리핑 자료", { timeout: 30000 });
  await page.waitForTimeout(4000);
  T.mark("ready", "상세 진입");

  await page.waitForTimeout(2400);
  T.mark("beat", "제시 끝");

  const brief = await rectText(page, "브리핑 자료");
  await point(page, brief, T, "브리핑 자료 자리", 2200);
  T.mark("beat", "방법 끝");

  await clickBox(page, await rectText(page, "브리핑 자료"), T, "브리핑 자료");
  await page.waitForTimeout(3000);
  const make = await rectText(page, "만들기");
  if (make) await clickBox(page, make, T, "만들기");
  T.mark("gen", "생성 시작");
  await page.waitForTimeout(30000);
  T.mark("gen", "생성 끝");
  await page.screenshot({ path: `${OUT}/q3-after-gen.png` });

  // 전체화면 — 자동 조작에서 막히면 그대로 두고 편집에서 대체한다
  const fs2 = await rectText(page, "전체화면");
  if (fs2) {
    await clickBox(page, fs2, T, "전체화면");
    await page.waitForTimeout(3000);
    const on = await page.evaluate(() => !!document.fullscreenElement);
    console.log(on ? "  ✓ 전체화면 열림" : "  ✗ 전체화면이 막혔다 — 편집에서 대체 필요");
    T.mark("full", on ? "전체화면 열림" : "전체화면 막힘");
  } else {
    console.log("  ✗ 전체화면 버튼 못 찾음");
  }
  await page.waitForTimeout(4000);
  T.mark("done", "퀘스트 3 완료");

  const video = page.video();
  await ctx.close(); await browser.close();
  fs.writeFileSync(`${OUT}/q3.json`, JSON.stringify(T.rows, null, 1));
  console.log("q3 영상:", await video.path());
}

if (want.includes("1")) await quest1();
if (want.includes("2")) await quest2();
if (want.includes("3")) await quest3(process.env.BT_PK || "/buildings/1002110700");
console.log("완료");
