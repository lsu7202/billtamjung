#!/usr/bin/env python3
r"""로그인해서 화면을 찍는다 — 검사용이 아니라 **보고용 캡처**(2026-09-05).

MCP 브라우저의 스크린샷은 「요소가 멈출 때까지」 기다리다 5초에 걸린다. 네이버 지도가
계속 다시 그려서 영영 안 멈춘다. 여기서는 **CDP 로 그냥 찍는다** — 안정 대기를 안 한다.

    data/.venv/bin/python scripts/shot.py <경로> <저장파일> [--click "글자"] [--wait 3]
"""
import argparse, base64, json, os, subprocess, time, urllib.request
import websocket

BASE = "http://localhost:5173"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9455
QA_ENV = os.environ.get("SHOT_ENV", "qa/screen/.qa_screen.env")


def creds():
    e = {}
    if os.path.exists(QA_ENV):
        for ln in open(QA_ENV, encoding="utf-8"):
            if "=" in ln and not ln.strip().startswith("#"):
                k, v = ln.split("=", 1)
                e[k.strip()] = v.strip()
    return (e.get("QA_EMAIL") or "qa-screen@qa.example.com",
            e.get("QA_PASSWORD") or "qascreen12345")


class Cdp:
    def __init__(self, port):
        self.n = 0
        for _ in range(80):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2); break
            except Exception: time.sleep(.5)
        tabs = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
                if t.get("type") == "page"]
        self.ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=300)

    def send(self, m, p=None):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": m, "params": p or {}}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.n: return r

    def js(self, e):
        r = self.send("Runtime.evaluate", {"expression": e, "awaitPromise": True,
                                           "returnByValue": True})
        return (r.get("result", {}).get("result", {}) or {}).get("value")

    def go(self, url, wait=3.0):
        self.send("Page.navigate", {"url": url}); time.sleep(wait)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path"); ap.add_argument("out")
    ap.add_argument("--click", action="append", default=[], help="누를 글자(여러 번 가능)")
    ap.add_argument("--wait", type=float, default=3.0)
    ap.add_argument("--probe", help="찍기 전에 돌려 볼 JS (결과를 찍는다)")
    ap.add_argument("--js", action="append", default=[], help="누르기 대신 돌릴 JS")
    ap.add_argument("--hover", help="찍기 전에 마우스를 올려 둘 곳 — CSS 선택자(첫 것의 가운데)")
    ap.add_argument("--w", type=int, default=1600); ap.add_argument("--h", type=int, default=1000)
    a = ap.parse_args()
    em, pw = creds()
    subprocess.run(["pkill", "-f", f"remote-debugging-port={PORT}"], capture_output=True)
    subprocess.run(["rm", "-rf", f"/tmp/cdp{PORT}"], capture_output=True)
    p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={PORT}",
                          "--disable-gpu", "--no-first-run", "--remote-allow-origins=*",
                          f"--window-size={a.w},{a.h}", f"--user-data-dir=/tmp/cdp{PORT}",
                          "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        c = Cdp(PORT); c.send("Page.enable")
        c.go(f"{BASE}/login", 3)
        c.js(f"""(function(){{
          var e=document.querySelector('input[type=email],input[name=email]');
          var w=document.querySelector('input[type=password],input[name=password]');
          function set(el,v){{var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
            s.call(el,v); el.dispatchEvent(new Event('input',{{bubbles:true}}));}}
          if(e&&w){{set(e,'{em}');set(w,'{pw}');
            var f=e.closest('form'); if(f) f.requestSubmit ? f.requestSubmit() : f.submit();
            else w.dispatchEvent(new KeyboardEvent('keydown',{{key:'Enter',bubbles:true}}));}}
          return !!e;}})()""")
        time.sleep(4)
        c.go(BASE + a.path, a.wait)
        for txt in a.click:
            # 딱 맞는 것 먼저, 없으면 포함하는 것 — 「계약 3」처럼 숫자가 붙은 칩을 잡는다
            c.js("(function(){var t=%s;"
                 "var all=[].slice.call(document.querySelectorAll('button,a,[role=tab],div,span'))"
                 ".filter(function(e){return e.children.length<3 && e.innerText});"
                 "var el=all.filter(function(e){return e.innerText.trim()===t});"
                 "if(!el.length) el=all.filter(function(e){return e.innerText.trim().indexOf(t)===0});"
                 "if(el.length) el[0].click(); return el.length})()" % json.dumps(txt))
            time.sleep(a.wait)
        for expr in a.js:
            c.js(expr); time.sleep(a.wait)
        if a.hover:   # 진짜 마우스를 올린다(CDP) — 호버 말풍선은 JS 로 흉내 낸 mouseover 로는 안 뜬다
            pos = c.js("(() => { const el = document.querySelector(" + json.dumps(a.hover) + "); if (!el) return null;"
                       " const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()")
            if pos:   # 밖에서 안으로 들어가야 mouseover 가 난다 — 두 번 움직인다
                c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pos[0] - 60, "y": pos[1] - 60})
                time.sleep(0.3)
                c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pos[0], "y": pos[1]})
                time.sleep(0.4)
                c.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": pos[0] + 1, "y": pos[1] + 1})
                time.sleep(1.2)
        if a.probe:
            print("  probe:", json.dumps(c.js(a.probe), ensure_ascii=False)[:900])
        c.js("(function(){var s=document.createElement('style');"
             "s.textContent='*{animation:none!important;transition:none!important}';"
             "document.head.appendChild(s);})()")
        time.sleep(1.2)
        r = c.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        if "result" not in r:
            print("✗", json.dumps(r)[:200]); return 1
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        open(a.out, "wb").write(base64.b64decode(r["result"]["data"]))
        print(f"  {a.out} · {os.path.getsize(a.out)//1024}KB")
        return 0
    finally:
        p.terminate()


raise SystemExit(main())
