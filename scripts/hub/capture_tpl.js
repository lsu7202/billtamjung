/* 건축HUB inputxml 템플릿 뜨기 — download_seoul.py 가 쓰는 _tpl/*.xml 을 만든다.
 *
 * ## 왜 사람 손이 한 번 필요한가
 * 격자가 BI Matrix 라 화면이 캔버스로 그려지고, 내보내기 요청에 실리는 inputxml(20KB)은
 * 리포트 정의(칸 77개 + 파라미터 122개)를 클라이언트가 통째로 직렬화한 것이다.
 * 서버가 주는 게 아니라서 받아 올 데가 없다. 화면을 한 번 몰아 그 요청을 가로채는 수밖에 없다.
 * 한 번 뜨면 그 뒤로는 순수 HTTP 다 — 바뀌는 것은 :VS_SIGUNGU 다섯 자리뿐이다.
 *
 * ## 쓰는 법
 * 1) www.hub.go.kr 에 로그인한다. **이때 download_seoul.py 를 돌리면 안 된다**
 *    (HUB 는 한 계정에 세션 하나라 서로를 끊는다).
 * 2) 아무 유형별 화면을 연다. 예: /portal/opn/tyb/idx-bdrg-ttlldr.do
 * 3) 콘솔에 이 파일을 붙여 넣고 run(PAGES, '강남구') 를 부른다.
 *    PAGES 는 scripts/hub/_tpl/pages.json 의 [grp, name, rCode] 목록.
 * 4) 끝나면 copy(JSON.stringify(__caps)) 로 복사해 .caps.json 에 저장하고
 *    save_tpl.py 를 돌린다.
 *
 * ## 두 가지 함정
 * - **버튼은 이미지 이름으로 찾는다.** 자리(x,y)로 찾으면 화면마다 줄이 달라 빗나간다
 *   (에너지 화면은 「사용년월」 줄이 하나 더 있어 내보내기 단추가 52px 아래에 있다).
 * - **건이 0인 법정동에서는 내보내기가 막힌다.** 화면이 「조회된 데이터가 없습니다」로
 *   끊는다. 그래서 건이 나올 때까지 법정동을 훑는다. 주택인허가는 종로구 가회동에
 *   한 건도 없어 17장이 통째로 실패했다 — 강남구 개포동에서 다 잡혔다.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__caps = window.__caps || {};
window.__log = [];

async function capture(rCode, sggName, maxBjd = 14) {
  const f = document.getElementById('REPORT_VIEW');
  f.src = '/portal/cmm/bim/idx-bi-matrix.do?rCode=' + rCode;

  // 리포트가 다 그려질 때까지 — 단추 이미지가 붙었는지로 본다
  let d, w, t0 = Date.now(), ready = false;
  while (Date.now() - t0 < 60000) {
    await sleep(800);
    d = f.contentDocument; w = f.contentWindow;
    if (!d) continue;
    const named = [...d.querySelectorAll('div[id^=Image] img')]
      .filter((i) => /btn_(검색|CSV)/.test(decodeURIComponent(i.getAttribute('src') || '')));
    const sels = [...d.querySelectorAll('select')];
    if (named.length >= 2 && sels.length >= 2 && sels[0].options.length > 5) { ready = true; break; }
  }
  if (!ready) return { rCode, err: 'no-render' };

  w.alert = function () {};                     // 「법정동을 선택하세요」류를 삼킨다
  const orig = w.XMLHttpRequest.prototype.send;
  let cap = null;
  w.XMLHttpRequest.prototype.send = function (body) {
    // 내보내기 요청은 **잡아만 두고 보내지 않는다** — 파일까지 만들 필요가 없다
    if (typeof body === 'string' && body.indexOf('service.ExportService') !== -1) { cap = body; return; }
    return orig.call(this, body);
  };
  const done = (r) => { w.XMLHttpRequest.prototype.send = orig; return r; };

  const btn = (nm) => {
    const im = [...d.querySelectorAll('div[id^=Image] img')]
      .find((i) => decodeURIComponent(i.getAttribute('src') || '').includes('btn_' + nm));
    return im ? im.closest('div[id^=Image]') : null;
  };
  const fire = (el) => {
    if (!el) return false;
    const b = el.getBoundingClientRect();
    for (const t of ['mouseover', 'mousedown', 'mouseup', 'click'])
      el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w,
        clientX: b.x + b.width / 2, clientY: b.y + b.height / 2, button: 0 }));
    return true;
  };
  const byText = (t) => [...d.querySelectorAll('div')]
    .find((e) => !e.childElementCount && (e.textContent || '').trim() === t);
  const count = () => {
    const m = d.body.innerText.match(/총\s*([\d,]+)\s*개/);
    return m ? +m[1].replace(/,/g, '') : 0;
  };
  const sels = [...d.querySelectorAll('select')];
  const pick = (s, txt, idx) => {
    const o = txt ? [...s.options].find((x) => x.text.trim() === txt) : s.options[idx];
    if (!o) return null;
    s.value = o.value;
    s.dispatchEvent(new w.Event('change', { bubbles: true }));
    return o.text.trim();
  };

  if (!pick(sels[0], '서울특별시')) return done({ rCode, err: 'no-sido' });
  await sleep(1800);
  if (!pick(sels[1], sggName)) return done({ rCode, err: 'no-sgg' });
  await sleep(1800);

  let n = 0, bjd = null;
  const lim = Math.min(maxBjd, sels[2] ? sels[2].options.length - 1 : 0);
  for (let i = 1; i <= lim; i++) {
    bjd = pick(sels[2], null, i);
    await sleep(900);
    fire(btn('검색'));
    await sleep(3500);
    n = count();
    if (n > 0) break;
  }
  if (!n) return done({ rCode, err: 'no-data', tried: lim });

  if (!fire(btn('CSV'))) return done({ rCode, err: 'no-csv-btn', n, bjd });
  await sleep(1800);
  const purpose = byText('웹사이트개발'); if (purpose) fire(purpose);   // 활용 목적(필수)
  await sleep(400);
  const ok = byText('확인'); if (ok) fire(ok);
  await sleep(3000);

  if (!cap) return done({ rCode, err: 'no-capture', n, bjd });
  window.__caps[rCode] = cap;
  return done({ rCode, n, bjd, len: cap.length });
}

async function run(pages, sggName) {
  for (const [grp, name, rCode] of pages) {
    if (window.__caps[rCode]) continue;
    let r;
    try { r = await capture(rCode, sggName); }
    catch (e) { r = { rCode, err: String(e).slice(0, 70) }; }
    window.__log.push({ grp, name, ...r });
    console.log(grp, name, r.err || `${r.n}건 (${r.bjd}) ${r.len}B`);
  }
  console.log('끝 — 실패', window.__log.filter((x) => x.err).length, '장');
}
