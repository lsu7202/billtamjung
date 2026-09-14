/* 조작 녹화 공용 — 커서·예고 상자·부드러운 이동·타임라인 기록.
 *
 * 녹화 영상에는 마우스 포인터가 찍히지 않는다. 그래서 페이지에 커서를 심고
 * 진짜 마우스 좌표를 따라다니게 한다(실제 입력 이벤트라 mousemove가 그대로 온다).
 * 누를 자리는 0.6초 전에 상자로 예고한다 — 어디를 누르는지 보여야 따라 할 수 있다.
 */

export const CURSOR = `
(() => {
  // 주입 스크립트는 문서가 만들어지기 전에 돈다 — 그때 붙이면 조용히 실패한다.
  // DOM이 준비된 뒤에 심고, 이미 준비돼 있으면 바로 심는다.
  const install = () => {
  if (window.__btCursor) return;
  window.__btCursor = true;
  const wrap = document.createElement('div');
  wrap.id = '__bt_cursor';
  wrap.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;' +
    'transform:translate(-100px,-100px);will-change:transform';
  wrap.innerHTML =
    '<svg width="30" height="36" viewBox="0 0 30 36" style="filter:drop-shadow(0 3px 6px rgba(0,0,0,.45))">' +
    '<path d="M4 2 L4 27 L10.5 21.2 L14.8 31.4 L19.6 29.3 L15.4 19.4 L24 18.6 Z" ' +
    'fill="#FFFFFF" stroke="#262320" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(wrap);

  const ripple = document.createElement('div');
  ripple.id = '__bt_ripple';
  ripple.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;' +
    'width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;opacity:0;' +
    'background:radial-gradient(circle, rgba(226,58,46,.85) 0%, rgba(226,58,46,0) 70%)';
  document.documentElement.appendChild(ripple);

  const box = document.createElement('div');
  box.id = '__bt_box';
  box.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;opacity:0;' +
    'border:4px solid #E23A2E;border-radius:10px;' +
    'box-shadow:0 0 0 5px rgba(226,58,46,.22), 0 0 22px rgba(226,58,46,.45), 0 8px 24px rgba(0,0,0,.22);' +
    'transition:opacity .18s ease, left .28s cubic-bezier(.2,.9,.2,1), top .28s cubic-bezier(.2,.9,.2,1),' +
    'width .28s cubic-bezier(.2,.9,.2,1), height .28s cubic-bezier(.2,.9,.2,1)';
  document.documentElement.appendChild(box);

  addEventListener('mousemove', (e) => {
    wrap.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
  }, true);

  addEventListener('mousedown', (e) => {
    wrap.querySelector('svg').style.transform = 'scale(.86)';
    ripple.style.transition = 'none';
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.style.opacity = '1';
    ripple.style.transform = 'scale(.35)';
    requestAnimationFrame(() => {
      ripple.style.transition = 'opacity .45s ease, transform .45s cubic-bezier(.2,.9,.2,1)';
      ripple.style.opacity = '0';
      ripple.style.transform = 'scale(1.25)';
    });
  }, true);

  addEventListener('mouseup', () => {
    wrap.querySelector('svg').style.transform = 'scale(1)';
  }, true);

  window.__btBox = (r) => {
    const b = document.getElementById('__bt_box');
    if (!b) return;
    if (!r) { b.style.opacity = '0'; return; }
    const pad = r.pad ?? 6;
    b.style.left = (r.x - pad) + 'px';
    b.style.top = (r.y - pad) + 'px';
    b.style.width = (r.w + pad * 2) + 'px';
    b.style.height = (r.h + pad * 2) + 'px';
    b.style.opacity = '1';
  };
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
`;

/** 페이지 전환·재렌더로 커서가 사라졌으면 다시 심는다 */
export async function ensureCursor(page) {
  await page.evaluate(CURSOR).catch(() => {});
  return page.evaluate(() => !!document.getElementById("__bt_cursor"));
}

/** 사람처럼 움직인다 — 곧장 순간이동하면 따라갈 수 없다 */
export async function moveTo(page, x, y, { steps = 26 } = {}) {
  await page.mouse.move(x, y, { steps });
  await page.waitForTimeout(120);
}

/** 요소 중앙 좌표와 크기 */
export async function boxOf(page, selector, nth = 0) {
  return page.evaluate(([sel, n]) => {
    const el = document.querySelectorAll(sel)[n];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [selector, nth]);
}

export async function boxOfText(page, text, tag = "button") {
  return page.evaluate(([t, g]) => {
    const el = [...document.querySelectorAll(g)].find((e) => e.textContent.trim().includes(t));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [text, tag]);
}

/** 대상이 화면 밖이면 안으로 스크롤한 뒤 좌표를 다시 잰다.
 *  사람은 보이는 것을 누른다 — 화면 밖 좌표를 찌르면 조작이 기계처럼 보이고, 클릭이 빗나가기도 한다. */
async function bringIntoView(page, box) {
  const vh = await page.evaluate(() => window.innerHeight);
  const margin = 90;
  if (box.cy > margin && box.cy < vh - margin) return box;
  // 스크롤한 뒤 **같은 요소의 새 좌표**를 돌려받아야 한다.
  // 옛 좌표로 누르면 스크롤된 만큼 어긋나 엉뚱한 것이 눌린다(실제로 그랬다).
  const next = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(Math.max(1, Math.min(window.innerWidth - 1, x)),
                                         Math.max(1, Math.min(window.innerHeight - 1, y)));
    if (!el) return null;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, [box.cx, Math.max(1, Math.min(box.cy, vh - 1))]);
  await page.waitForTimeout(450);
  return next ?? box;
}

/** 예고 상자 → 이동 → 클릭. 이 순서가 지켜져야 "어디를 누르는지"가 보인다. */
export async function clickBox(page, box, T, label, { hold = 620, pad = 10 } = {}) {
  if (!box) throw new Error(`대상을 못 찾음: ${label}`);
  box = await bringIntoView(page, box);
  await page.evaluate((r) => window.__btBox(r), { ...box, pad });
  T.mark("box", label, box);
  await moveTo(page, box.cx, box.cy);
  await page.waitForTimeout(hold);
  T.mark("click", label, box);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(520);                 // 누른 자리를 잠깐 더 보여준다
  await page.evaluate(() => window.__btBox(null));
}

/** 조작 시각 기록 — 편집에서 나레이션·확대·퀘스트 띠를 여기에 맞춘다 */
export function timeline() {
  const t0 = Date.now();
  const rows = [];
  return {
    /** at = {cx,cy} 를 주면 그 지점을 남긴다 — 편집에서 그쪽으로 확대한다 */
    mark(kind, label, at) {
      rows.push({
        t: +((Date.now() - t0) / 1000).toFixed(2), kind, label,
        ...(at ? { x: Math.round(at.cx), y: Math.round(at.cy) } : {}),
      });
    },
    rows,
  };
}
