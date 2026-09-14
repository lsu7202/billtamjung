"""크롬 CDP 로 머리글·꼬리글 없이 PDF 를 뽑는다.
CLI 의 --print-to-pdf 로는 날짜·URL 머리글을 못 끈다."""
import base64, json, os, subprocess, sys, time, urllib.request
import websocket  # websocket-client

SRC, OUT = sys.argv[1], sys.argv[2]
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
port = 9333
p = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}",
                      "--disable-gpu", "--no-first-run", "--remote-allow-origins=*",
                      f"--user-data-dir=/tmp/cdp{port}", "about:blank"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(60):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            break
        except Exception: time.sleep(0.5)
    # **쪽(page) 타깃을 새로 연다.** /json 첫 줄은 브라우저 타깃이라 Page.* 가 없다
    tabs = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            if t.get("type") == "page"]
    if not tabs:
        tabs = [json.load(urllib.request.urlopen(
            urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")))]
    ws = websocket.create_connection(tabs[0]["webSocketDebuggerUrl"], timeout=180)
    def send(i, m, prm=None):
        ws.send(json.dumps({"id": i, "method": m, "params": prm or {}}))
        while True:
            r = json.loads(ws.recv())
            if r.get("id") == i: return r
    send(1, "Page.enable")
    send(2, "Page.navigate", {"url": "file://" + os.path.abspath(SRC)})
    time.sleep(3.5)
    r = send(3, "Page.printToPDF", {
        "printBackground": True, "preferCSSPageSize": True,
        "displayHeaderFooter": False})
    if "result" not in r:
        print("  ✗", json.dumps(r, ensure_ascii=False)[:400]); raise SystemExit(1)
    open(OUT, "wb").write(base64.b64decode(r["result"]["data"]))
    print(f"  {OUT} · {os.path.getsize(OUT)//1024}KB")
finally:
    p.terminate()
