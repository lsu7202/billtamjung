/* 검증 전용 — 진짜 마우스 드래그로 네이버 지도에 영역이 그려지는지만 본다.
 * 이게 안 되면 가이드 영상 전체가 성립하지 않으므로 제일 먼저 확인한다. */
import { chromium } from "playwright";
import { CURSOR, moveTo, boxOfText } from "./lib.mjs";

const OUT = "out";
const EMAIL = "demo@billtamjung.app";
const PW = "btdemo2026!";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: `${OUT}/probe`, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

// networkidle은 지도 타일이 계속 붙어서 영원히 안 온다 — domcontentloaded + 명시적 대기
await page.goto("https://billtamjung.web.app/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="password"]', { timeout: 30000 });
await page.fill('input[placeholder*="이메일"], input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.keyboard.press("Enter");
// 신규 계정은 /welcome(온보딩)으로 간다 — 영상엔 안 쓰므로 바로 검색으로
await page.waitForURL(/\/(search|welcome)/, { timeout: 30000 });
if (page.url().includes("/welcome")) await page.goto("https://billtamjung.web.app/search");
await page.waitForSelector('button.tool-btn', { timeout: 30000 });

// 지도 타일이 다 뜰 때까지 기다린다 — 회색 빈 타일이 찍히면 못 쓴다
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/probe-01-loaded.png` });

// 자유곡선 켜기
const free = await boxOfText(page, "", "button.tool-btn");
const tools = await page.evaluate(() => {
  const bs = [...document.querySelectorAll("button.tool-btn")];
  return bs.map((x, i) => ({ i, title: x.title, ...x.getBoundingClientRect().toJSON() }));
});
console.log("도구 버튼:", tools.map((t) => `${t.i}:${t.title}`).join(" "));

const freeBtn = tools.find((t) => (t.title || "").includes("자유곡선"));
if (!freeBtn) { console.log("자유곡선 버튼 못 찾음"); await ctx.close(); await b.close(); process.exit(1); }

await moveTo(page, freeBtn.x + freeBtn.width / 2, freeBtn.y + freeBtn.height / 2);
await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/probe-02-tool-on.png` });

// 지도 영역 안에서 닫힌 고리를 그린다 (가속·감속)
const map = await page.evaluate(() => {
  const el = document.querySelector('[class*="map"]') || document.body;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log("지도 영역:", JSON.stringify(map));

const cx = map.x + map.w * 0.55, cy = map.y + map.h * 0.5;
const rx = Math.min(map.w, map.h) * 0.30, ry = Math.min(map.w, map.h) * 0.26;
const pts = [];
const N = 64;
for (let i = 0; i <= N; i++) {
  const a = (i / N) * Math.PI * 2 - Math.PI / 2;
  // 살짝 찌그러진 고리 — 손으로 그린 느낌
  const wob = 1 + 0.06 * Math.sin(a * 3);
  pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
}

await moveTo(page, pts[0][0], pts[0][1], { steps: 30 });
await page.waitForTimeout(300);
await page.mouse.down();
for (let i = 1; i < pts.length; i++) {
  const t = i / pts.length;
  const ease = t < 0.15 ? 3 : t > 0.85 ? 3 : 1;      // 시작·끝은 천천히
  await page.mouse.move(pts[i][0], pts[i][1], { steps: ease });
  if (i % 8 === 0) await page.waitForTimeout(16);
}
await page.waitForTimeout(200);
await page.mouse.up();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/probe-03-drawn.png` });

// 결과 수가 바뀌었는지
const count = await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((e) =>
    /전체\s*\d+건/.test(e.textContent) && e.children.length === 0);
  return el ? el.textContent.trim() : "(못 찾음)";
});
console.log("결과 표시:", count);

await ctx.close();
await b.close();
console.log("완료 —", OUT);
