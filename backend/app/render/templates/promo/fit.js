/* 제목은 한 줄 — 지면 폭에 맞을 때까지 글자를 줄인다(꺾지도 자르지도 않는다) */
document.querySelectorAll(".slide h1").forEach(function (h) {
  var s = parseFloat(getComputedStyle(h).fontSize);
  while (h.scrollWidth > h.clientWidth && s > 24) { s -= 2; h.style.fontSize = s + "px"; }
});
