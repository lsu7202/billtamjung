import { useEffect, useRef } from "react";

/** 살아있는 스카이라인 — 창문이 골드로 깜빡이는 서울의 밤(캔버스 1장·DOM 부하 없음). */
export function CityCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0;
    type Win = { x: number; y: number; on: boolean; t: number };
    let blds: { x: number; w: number; h: number; win: Win[] }[] = [];
    const dpr = devicePixelRatio || 1;
    function build() {
      W = cv.width = innerWidth * dpr;
      H = cv.height = innerHeight * 0.38 * dpr;
      blds = [];
      let x = 0;
      while (x < W) {
        const w = (18 + Math.random() * 40) * dpr, h = Math.min((30 + Math.random() * 0.75 * (H / dpr)) * dpr, H - 6 * dpr);
        const win: Win[] = [];
        for (let wy = H - h + 8 * dpr; wy < H - 8 * dpr; wy += 9 * dpr)
          for (let wx = x + 4 * dpr; wx < x + w - 6 * dpr; wx += 8 * dpr)
            if (Math.random() < 0.5) win.push({ x: wx, y: wy, on: Math.random() < 0.22, t: Math.random() * 9000 });
        blds.push({ x, w, h, win });
        x += w + (2 + Math.random() * 8) * dpr;
      }
    }
    function draw(ts: number) {
      cx.clearRect(0, 0, W, H);
      for (const b of blds) {
        cx.fillStyle = "rgba(12,10,8,.92)";
        cx.fillRect(b.x, H - b.h, b.w, b.h);
        for (const w of b.win) {
          if (!reduced && ts > w.t) { w.on = Math.random() < 0.3; w.t = ts + 3000 + Math.random() * 9000; }
          cx.fillStyle = w.on ? "rgba(231,200,118,.75)" : "rgba(255,255,255,.05)";
          cx.fillRect(w.x, w.y, 3.5 * dpr, 4.5 * dpr);
        }
      }
      raf = requestAnimationFrame(draw);
    }
    build();
    raf = requestAnimationFrame(draw);
    addEventListener("resize", build);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", build); };
  }, []);
  return <canvas ref={ref} className="s00-city" />;
}

/** 비밀번호 재설정 — 베타: 메일 발송 스텁이라 콘솔/관리자에서 받은 토큰을 입력해 새 비번 설정. */
