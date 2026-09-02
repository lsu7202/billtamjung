/* 사대문 경계만 빠르게 그려 보고 캡처한다. 영상 전체를 다시 찍지 않고 모양만 맞추기 위한 것.
 *
 *   node draw-probe.mjs        # corners.json 대로 그려서 out/draw.png
 *
 * 꼭짓점은 corners.json 에서 읽는다(main 영역 기준 0~1 비율). 고치고 다시 돌리면 된다.
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { CURSOR, ensureCursor, moveTo } from "./lib.mjs";

const CORNERS = JSON.parse(fs.readFileSync("corners.json", "utf8"));

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

await page.goto("https://billtamjung.web.app/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="password"]');
await page.fill('input[type="email"], input[placeholder*="이메일"]', "demo@billtamjung.app");
await page.fill('input[type="password"]', "btdemo2026!");
await page.keyboard.press("Enter");
await page.waitForURL(/\/(search|welcome)/);
if (page.url().includes("/welcome")) await page.goto("https://billtamjung.web.app/search");
await page.waitForSelector("button.tool-btn");
await ensureCursor(page);
await page.waitForTimeout(3500);

// 지도를 사대문으로
const q = page.locator('input[placeholder*="주소 또는 지명"]');
await q.click();
await q.type("종로3가역", { delay: 35 });
await page.waitForTimeout(1100);
await page.keyboard.press("Enter");
await page.waitForTimeout(3500);
await page.mouse.move(1150, 640);
await page.mouse.wheel(0, 240);
await page.waitForTimeout(3000);

// ── 좌표 보정 ── 지도를 두 곳 눌러 위경도를 받아 변환식을 만든다.
// 화면 비율로 찍으면 지형지물과 안 맞는다(여러 번 어긋났다).
const hits = [];
page.on("request", (r) => {
  const m = r.url().match(/parcel-at\?lng=([\d.-]+)&lat=([\d.-]+)/);   // lng 가 먼저다
  if (m) hits.push({ lng: +m[1], lat: +m[2] });
});
const CAL = [[900, 500], [1500, 850]];
for (const [x, y] of CAL) {
  await moveTo(page, x, y, { steps: 6 });
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2200);
}
if (hits.length < 2) { console.log("보정 실패 — parcel-at 응답 없음:", hits.length); await b.close(); process.exit(1); }
const [A, B2] = hits;
const sx = (CAL[1][0] - CAL[0][0]) / (B2.lng - A.lng);      // px per deg lng
const sy = (CAL[1][1] - CAL[0][1]) / (B2.lat - A.lat);      // px per deg lat (음수)
const toXY = (lat, lng) => [CAL[0][0] + (lng - A.lng) * sx, CAL[0][1] + (lat - A.lat) * sy];
console.log("보정 완료 · 1도(경도) =", Math.round(sx), "px");

// 자유곡선 켜기
const free = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button.tool-btn")].find((x) => (x.title || "").includes("자유곡선"));
  const r = el.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
await moveTo(page, free.cx, free.cy);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(600);

// 네이버는 캔버스를 화면보다 크게 그린다 — 그걸 잘라내는 컨테이너가 실제 지도 화면이다
const map = await page.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")]
    .filter((e) => e.getBoundingClientRect().width > 600)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!c) { const r = document.querySelector("main").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
  const cw = c.getBoundingClientRect().width;
  let el = c.parentElement;
  while (el && el.getBoundingClientRect().width >= cw) el = el.parentElement;
  const r = (el || c).getBoundingClientRect();
  // 컨테이너 높이가 0으로 잡히는 경우가 있다(플렉스) — 화면 아래 도구줄까지로 채운다
  const h = r.height > 100 ? r.height : window.innerHeight - r.y - 44;
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(h) };
});
console.log("지도 영역:", JSON.stringify(map));
const pts = [];
for (let i = 0; i < CORNERS.length - 1; i++) {
  const [alat, alng] = CORNERS[i], [blat, blng] = CORNERS[i + 1];
  const seg = 6;
  for (let k = 0; k < seg; k++) {
    const t = k / seg;
    pts.push(toXY(alat + (blat - alat) * t, alng + (blng - alng) * t));
  }
}
pts.push(toXY(...CORNERS[0]));

console.log("첫 점:", pts[0].map(Math.round), "· 점 수:", pts.length);
await moveTo(page, pts[0][0], pts[0][1], { steps: 20 });
await page.waitForTimeout(300);
await page.mouse.down();
for (let i = 1; i < pts.length; i++) {
  await page.mouse.move(pts[i][0], pts[i][1], { steps: 4 });
  await page.waitForTimeout(30);            // 너무 빠르면 지도가 점을 놓친다
}
await page.waitForTimeout(400);
await page.mouse.up();
await page.waitForTimeout(7000);

await page.screenshot({ path: "out/draw.png" });
const n = await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /전체\s*[\d,]+건/.test(e.textContent));
  return el ? el.textContent.trim() : "?";
});
console.log("결과:", n, "· 캡처 out/draw.png");
await b.close();
