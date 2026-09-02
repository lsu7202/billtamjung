/* 검증 3 — 조건 팝오버 안에서 값을 어떻게 넣을 수 있는지(입력칸/프리셋/슬라이더) 본다. */
import { chromium } from "playwright";
import { CURSOR, ensureCursor } from "./lib.mjs";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
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
await page.waitForTimeout(3000);

await page.locator('button:has-text("필터")').first().click();
await page.waitForTimeout(900);

const dump = async (chip) => {
  await page.locator(`span.vchip:has-text("${chip}")`).first().click();
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    // 팝오버는 「이 조건 지우기」를 품고 있다 — 그걸 기준으로 위로 올라가 컨테이너를 찾는다
    const anchor = [...document.querySelectorAll("*")].find(
      (e) => e.children.length === 0 && e.textContent.trim() === "이 조건 지우기");
    let p = anchor;
    while (p && p.getBoundingClientRect().width < 260) p = p.parentElement;
    if (!p) return null;
    return {
      inputs: [...p.querySelectorAll("input")].map((i) => ({ type: i.type, ph: i.placeholder, val: i.value, cls: i.className })),
      buttons: [...p.querySelectorAll("button")].map((b) => b.textContent.trim()).slice(0, 14),
      labels: [...p.querySelectorAll("label")].map((l) => l.textContent.trim()).slice(0, 10),
      html: p.innerHTML.slice(0, 500),
    };
  });
  console.log(`\n===== ${chip} =====`);
  console.log("입력칸:", JSON.stringify(info?.inputs));
  console.log("버튼:", JSON.stringify(info?.buttons));
  console.log("html:", (info?.html || "").replace(/\s+/g, " ").slice(0, 420));
  // 닫기
  await page.evaluate(() => {
    const back = [...document.querySelectorAll("div")].find((d) =>
      d.children.length === 0 && getComputedStyle(d).position === "fixed" && d.getBoundingClientRect().width > 1000);
    back?.click();
  });
  await page.waitForTimeout(400);
};

await dump("매매가");
await page.locator('.idx-item:has-text("토지정보")').click(); await page.waitForTimeout(500);
await dump("토지이용상황");
await page.locator('.idx-item:has-text("건물정보")').click(); await page.waitForTimeout(500);
await dump("주용도");

await b.close();
