/* 사용자가 직접 찍은 영상을 훑는다 — 일정 간격으로 프레임을 뽑아 무슨 화면인지 본다. */
import { chromium } from "playwright";
const SRC = process.argv[2];
const OUT = "/private/tmp/claude-501/-Users-iseung-ug-Desktop---------/39cc5cd3-f468-4bff-abf2-ec0bd655759c/scratchpad/scan";
const times = process.argv.slice(3).map(Number);
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.setContent(`<body style="margin:0;background:#000"><video id=v muted style="width:1920px;height:1080px;object-fit:contain"></video></body>`);
await p.evaluate((s) => { document.getElementById("v").src = s; }, "file://" + SRC);
await p.waitForFunction(() => { const v = document.getElementById("v"); return v && v.readyState >= 2; }, null, { timeout: 120000 });
const d = await p.evaluate(() => document.getElementById("v").duration);
console.log("길이", d.toFixed(1), "초");
for (const t of times) {
  await p.evaluate((t) => new Promise((r) => { const v = document.getElementById("v"); v.onseeked = () => r(); v.currentTime = t; }), t);
  await p.waitForTimeout(320);
  await p.screenshot({ path: `${OUT}-${String(Math.round(t)).padStart(3, "0")}.png` });
}
await b.close();
console.log("완료", times.length, "장");
