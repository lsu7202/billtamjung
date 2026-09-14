/* 검증 2 — 촬영 전에 확정해야 하는 세 가지만 본다.
 *   ① 커서·예고 상자가 화면에 실제로 찍히는가
 *   ② 지도를 사대문으로 옮기고 축척을 맞출 수 있는가
 *   ③ 그 범위에 조건을 걸었을 때 결과가 비지 않는가 (0건이면 촬영이 성립하지 않는다)
 */
import { chromium } from "playwright";
import { CURSOR, moveTo, ensureCursor } from "./lib.mjs";

const OUT = "out";
const EMAIL = "demo@billtamjung.app";
const PW = "btdemo2026!";
const shot = (p, n) => p.screenshot({ path: `${OUT}/p2-${n}.png` });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await ctx.addInitScript(CURSOR);
const page = await ctx.newPage();

await page.goto("https://billtamjung.web.app/login", { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[type="password"]', { timeout: 30000 });
await page.fill('input[placeholder*="이메일"], input[type="email"]', EMAIL);
await page.fill('input[type="password"]', PW);
await page.keyboard.press("Enter");
await page.waitForURL(/\/(search|welcome)/, { timeout: 30000 });
if (page.url().includes("/welcome")) await page.goto("https://billtamjung.web.app/search");
await page.waitForSelector("button.tool-btn", { timeout: 30000 });
await page.waitForTimeout(4000);

/* ① 커서가 살아 있는가 */
console.log("① 재주입:", await ensureCursor(page));
await moveTo(page, 960, 600);
const cur = await page.evaluate(() => {
  const c = document.getElementById("__bt_cursor");
  return c ? { ok: true, t: c.style.transform, vis: getComputedStyle(c).visibility } : { ok: false };
});
console.log("① 커서:", JSON.stringify(cur));

/* 예고 상자도 떠 있는지 눈으로 확인 — 필터 버튼에 씌운다 */
const fb = await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("필터"));
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
await page.evaluate((r) => window.__btBox(r), fb);
await moveTo(page, fb.cx, fb.cy);
await page.waitForTimeout(400);
await shot(page, "01-cursor-box");
await page.evaluate(() => window.__btBox(null));

/* ② 지도를 사대문으로 — 검색으로 중심을 옮기고 휠로 축척을 넓힌다 */
const q = page.locator('input[placeholder*="주소 또는 지명"]');
await q.click();
for (const ch of "종로3가역") { await q.type(ch, { delay: 90 }); }
await page.waitForTimeout(1200);
await shot(page, "02-typed");
await page.keyboard.press("Enter");
await page.waitForTimeout(3500);
await shot(page, "03-moved");

// 휠로 축척 넓히기 — 진짜 휠 이벤트라 지도가 반응한다
for (let i = 0; i < 3; i++) { await page.mouse.move(1150, 640); await page.mouse.wheel(0, 240); await page.waitForTimeout(700); }
await page.waitForTimeout(2500);
await shot(page, "04-zoomed");

const zoomInfo = await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((e) => /^\d+m$|^\d+km$/.test(e.textContent.trim()) && e.children.length === 0);
  return el ? el.textContent.trim() : "(축척 표시 못 찾음)";
});
console.log("② 축척:", zoomInfo);

/* ③ 조건을 걸었을 때 결과가 남는가 — API로 바로 세어 본다 */
const token = await page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem("bt-auth") || "{}")?.state?.token || null; } catch { return null; }
});
console.log("③ 토큰:", token ? "확보" : "없음(로컬스토리지 키 확인 필요)");

const counts = await page.evaluate(async () => {
  const j = async (body) => {
    const r = await fetch("/api/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify(body),
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const d = await r.json();
    return d.total ?? (Array.isArray(d) ? d.length : JSON.stringify(d).slice(0, 80));
  };
  const region = { sido: "서울특별시", sigungu: "종로구" };
  return {
    종로구: await j({ ...region, limit: 1 }),
    "종로구+40~60억": await j({ ...region, price_min: 4000000000, price_max: 6000000000, limit: 1 }),
    "종로구+40~60억+상업용빌딩": await j({ ...region, price_min: 4000000000, price_max: 6000000000, land_uses: ["상업용"], limit: 1 }),
    "종로구+40~60억+제2종근생": await j({ ...region, price_min: 4000000000, price_max: 6000000000, main_uses: ["04000"], limit: 1 }),
  };
});
console.log("③ 건수:", JSON.stringify(counts, null, 1));

await b.close();
console.log("완료 —", OUT);
