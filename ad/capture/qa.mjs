/* 영상 QA — 자막이 나오는 시점의 프레임을 뽑아 화면과 대조할 수 있게 모아둔다.
 *
 *   node qa.mjs ../원본/퀘스트1.mp4 q1
 *
 * 편집표(guide_parts_q*.json)에서 각 조각의 한가운데 시각을 계산해 그 프레임을 저장한다.
 * 눈대중으로 "대충 맞겠지" 하다가 여러 번 틀렸다 — 조각마다 한 장씩 남겨 확인한다.
 */
import fs from "node:fs";
import { chromium } from "playwright";

const SRC = process.argv[2];
const TAG = process.argv[3] ?? "q1";
const PARTS = JSON.parse(fs.readFileSync(`../remotion/src/guide_parts_${TAG}.json`, "utf8"));
const OUT = `out/qa-${TAG}`;
fs.mkdirSync(OUT, { recursive: true });

// 조각 한가운데 시각 — 자막이 화면에 떠 있는 지점
let t = 0;
const marks = PARTS.map((p) => {
  const mid = t + p.len / 2;
  t += p.len;
  return { k: p.k ?? "무음", at: +mid.toFixed(2), focus: !!p.focus, src: p.src ?? "카드" };
});

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + fs.realpathSync(SRC));
await p.waitForFunction(() => { const v = document.querySelector("video"); return v && v.readyState >= 2; }, null, { timeout: 90000 });
await p.addStyleTag({ content: "body{margin:0;background:#000} video{width:1920px;height:1080px;object-fit:contain}" });

for (const m of marks) {
  await p.evaluate((s) => new Promise((r) => {
    const v = document.querySelector("video"); v.onseeked = () => r(); v.currentTime = s;
  }), m.at);
  await p.waitForTimeout(260);
  await p.screenshot({ path: `${OUT}/${String(m.at).padStart(6, "0")}-${m.k}.png` });
}
await b.close();

console.log(`QA 프레임 ${marks.length}장 → ${OUT}`);
console.log("강조 있는 조각:", marks.filter((m) => m.focus).map((m) => `${m.k}@${m.at}s`).join(" · ") || "없음");
console.log("영상 구간:", marks.filter((m) => m.src === "clip").map((m) => `${m.k}@${m.at}s`).join(" · ") || "없음");
