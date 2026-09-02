import { chromium } from "playwright";
const src = process.argv[2], times = process.argv.slice(3).map(Number);
const OUT = "/private/tmp/claude-501/-Users-iseung-ug-Desktop---------/39cc5cd3-f468-4bff-abf2-ec0bd655759c/scratchpad";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + src);                    // 크로미움이 webm을 직접 재생한다
await p.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 2; }, null, { timeout: 60000 });
await p.addStyleTag({ content: "body{margin:0;background:#000} video{width:1920px;height:1080px;object-fit:contain}" });
for (const t of times) {
  await p.evaluate((t) => new Promise((r) => { const v = document.querySelector("video"); v.onseeked = () => r(); v.currentTime = t; }), t);
  await p.waitForTimeout(350);
  await p.screenshot({ path: `${OUT}/v${t}.png` });
}
await b.close();
console.log("ok", times.join(","));
