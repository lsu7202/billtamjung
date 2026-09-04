#!/usr/bin/env python3
"""HTML → PDF. Chrome 을 CDP 로 몰아 머리글은 비우고 쪽번호만 남긴다.
   CLI --print-to-pdf 는 날짜·URL 이 박힌 기본 머리글을 끌 수 없다."""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request
import websockets

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9333

async def render(html_path, out_path):
    p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
                          "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                          "about:blank"],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ws_url = None
        for _ in range(60):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                for t in tabs:
                    if t.get("type") == "page":
                        ws_url = t["webSocketDebuggerUrl"]; break
                if ws_url: break
            except Exception: pass
            time.sleep(0.4)
        if not ws_url:
            print("크롬이 안 떴다"); return 1

        async with websockets.connect(ws_url, max_size=200_000_000) as ws:
            i = [0]
            async def cmd(method, params=None):
                i[0] += 1
                await ws.send(json.dumps({"id": i[0], "method": method, "params": params or {}}))
                while True:
                    m = json.loads(await ws.recv())
                    if m.get("id") == i[0]:
                        return m.get("result", {})
            await cmd("Page.enable")
            await cmd("Page.navigate", {"url": "file://" + os.path.abspath(html_path)})
            await asyncio.sleep(3.5)                      # 폰트·SVG 안정
            r = await cmd("Page.printToPDF", {
                "printBackground": True, "preferCSSPageSize": True,
                "displayHeaderFooter": True,
                "headerTemplate": "<span></span>",
                "footerTemplate": ('<div style="width:100%;font-size:8pt;color:#767676;'
                                   'font-family:-apple-system,sans-serif;padding:0 18mm;">'
                                   '<span style="float:right"><span class="pageNumber"></span></span></div>'),
                "marginTop": 0.87, "marginBottom": 0.79, "marginLeft": 0.71, "marginRight": 0.71,
            })
            open(out_path, "wb").write(base64.b64decode(r["data"]))
            print(f"  {out_path} · {os.path.getsize(out_path):,} bytes")
            return 0
    finally:
        p.terminate()

sys.exit(asyncio.run(render(sys.argv[1], sys.argv[2])))
