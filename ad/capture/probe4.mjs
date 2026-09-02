/* 검증 4 — 영역을 그렸을 때 화면이 실제로 무엇을 요청하고 무엇을 받는지 본다.
 * 서버는 정상(폴리곤 검색 1,884건 · 핀 652개)인데 화면이 0건이면 요청 쪽 문제다. */
import { chromium } from "playwright";
import { CURSOR, ensureCursor, moveTo } from "./lib.mjs";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/(search|search\/pins|search\/snap)$/.test(u)) return;
  let note = "";
  try {
    const j = await r.json();
    note = Array.isArray(j) ? `${j.length}개` :
      j.normal ? `normal ${j.normal.total} · mine ${j.mine.total}` :
      j.polygon ? "snap ok" : JSON.stringify(j).slice(0, 60);
  } catch { note = "(본문 없음)"; }
  console.log(`  ${r.status()}  ${u.replace(/.*\/api/, "")}  →  ${note}`);
});
page.on("requestfailed", (r) => console.log("  실패:", r.url().replace(/.*\/api/, ""), r.failure()?.errorText));

await page.goto("https://billtamjung.web.app/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="password"]');
await page.fill('input[type="email"], input[placeholder*="이메일"]', "demo@billtamjung.app");
await page.fill('input[type="password"]', "btdemo2026!");
await page.keyboard.press("Enter");
await page.waitForURL(/\/(search|welcome)/);
if (page.url().includes("/welcome")) await page.goto("https://billtamjung.web.app/search");
await page.waitForSelector("button.tool-btn");
await ensureCursor(page);
await page.waitForTimeout(3000);

// 종로3가역으로 이동 후 한 단계만 넓힌다
const q = page.locator('input[placeholder*="주소 또는 지명"]');
await q.click();
await q.type("종로3가역", { delay: 60 });
await page.waitForTimeout(900);
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
await page.mouse.move(1150, 640);
await page.mouse.wheel(0, 240);
await page.waitForTimeout(2500);

console.log("── 자유곡선 켜고 그린다 ──");
const free = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button.tool-btn")].find((b) => (b.title || "").includes("자유곡선"));
  const r = el.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
await moveTo(page, free.cx, free.cy);
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(600);

const map = await page.evaluate(() => {
  const r = document.querySelector("main").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const cx = map.x + map.w * 0.60, cy = map.y + map.h * 0.52;
const rx = map.h * 0.30, ry = map.h * 0.26;
const pts = [];
for (let i = 0; i <= 60; i++) {
  const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
  pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
}
await moveTo(page, pts[0][0], pts[0][1]);
await page.mouse.down();
for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i][0], pts[i][1], { steps: 2 });
await page.mouse.up();

console.log("── 응답 대기 12초 ──");
await page.waitForTimeout(12000);

const shown = await page.evaluate(() => {
  const t = document.body.innerText;
  const m1 = t.match(/이 지도 영역\s*([\d,]+)건/);
  const m2 = t.match(/전체\s*([\d,]+)건/);
  return { 지도영역: m1?.[1] ?? "?", 전체: m2?.[1] ?? "?", 빈목록: /표시할 매물이 없습니다/.test(t) };
});
console.log("화면 표시:", JSON.stringify(shown));
await page.screenshot({ path: "out/p4-final.png" });
await b.close();
