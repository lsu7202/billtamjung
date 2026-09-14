import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("file://" + process.cwd() + "/assets/make.html");
await p.waitForTimeout(1200);
for (const id of ["ext", "int", "int2", "int3", "int4", "land", "ledger"]) {
  await p.locator("#" + id).screenshot({ path: `assets/${id}.png` });
  console.log("  ✓", id);
}
await b.close();
