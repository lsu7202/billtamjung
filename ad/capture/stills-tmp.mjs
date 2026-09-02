import fs from "node:fs";
import { chromium } from "playwright";
const parts = JSON.parse(fs.readFileSync("../remotion/src/guide_parts.json", "utf8"));
const times = [...new Set(parts.filter((p) => p.src === "still").map((p) => p.at))];
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file:///tmp/guide.mp4");
await p.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 2; }, null, { timeout: 90000 });
await p.addStyleTag({ content: "body{margin:0;background:#000} video{width:1920px;height:1080px;object-fit:contain}" });
for (const t of times) {
  await p.evaluate((t) => new Promise((r) => { const v = document.querySelector("video"); v.onseeked = () => r(); v.currentTime = t; }), t);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `../remotion/public/stills/s${String(t).replace(".", "_")}.png` });
}
await b.close();
console.log("정지 컷", times.length, "장");
