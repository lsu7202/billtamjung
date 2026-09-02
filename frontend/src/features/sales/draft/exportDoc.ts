/** 문서 내보내기 — Word(.docx) 정식 포맷. 화면의 종이(.sheet)를 그대로 읽는다.
 *  .hwpx는 생성 라이브러리가 없어 지원하지 않는다 — 한글에서 .docx를 열어 작업한다. */
import {
  AlignmentType, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType,
} from "docx";

/* 종이에서 편집 부속을 걷어낸 사본 — 입력칸은 값 글자로 */
const cleanSheet = (s: Element): HTMLElement => {
  const cl = s.cloneNode(true) as HTMLElement;
  cl.querySelectorAll("button, .tl.tin, .tbank, .aacts, .pn, .pg").forEach((e) => e.remove());
  cl.querySelectorAll("input, textarea").forEach((e) => {
    const t = document.createElement("span");
    t.textContent = (e as HTMLInputElement).value;
    e.replaceWith(t);
  });
  return cl;
};
const txt = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/* ── Word(.docx) — 화면 구조(h2·문단·표)를 그대로 옮긴다 ── */
export async function exportDocx(fileBase: string) {
  const kids: (Paragraph | Table)[] = [];
  for (const sheet of document.querySelectorAll(".sheet .doc")) {
    // 열 너비는 원본에서 실측한다 — 1px ≈ 15twip(96dpi)
    const widthsOf = (t: Element): number[] | undefined => {
      const rows = Array.from(t.querySelectorAll("tr"));
      const tmpl = rows.find((tr2) => Array.from(tr2.children)
        .every((c) => Number((c as HTMLTableCellElement).colSpan || 1) === 1)) ?? rows[0];
      if (!tmpl) return undefined;
      const ws = Array.from(tmpl.children).map((c) => Math.round(c.getBoundingClientRect().width * 15));
      return ws.some((w) => w > 0) ? ws : undefined;
    };
    const origTables = Array.from(sheet.querySelectorAll("table")).map(widthsOf);
    let ti = 0;
    const cl = cleanSheet(sheet);
    const emit = (el: Element) => {
      const tag = el.tagName;
      if (tag === "H2") {
        kids.push(new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 240 },
          children: [new TextRun({ text: txt(el), bold: true, size: 38 })],
        }));
      } else if (tag === "TABLE") {
        const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
          new TableRow({
            children: Array.from(tr.children).map((td) => {
              const lab = td.tagName === "TH" || td.classList.contains("lab");
              return new TableCell({
                columnSpan: Number((td as HTMLTableCellElement).colSpan || 1),
                rowSpan: Number((td as HTMLTableCellElement).rowSpan || 1),
                shading: lab ? { type: ShadingType.CLEAR, fill: "F2F3F5" } : undefined,
                children: [new Paragraph({
                  alignment: lab ? AlignmentType.CENTER : AlignmentType.LEFT,
                  children: [new TextRun({ text: txt(td), bold: lab, size: 19 })],
                })],
              });
            }),
          }));
        const cw = origTables[ti]; ti += 1;
        if (rows.length) kids.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          columnWidths: cw, rows }));
        kids.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      } else if (el.classList.contains("terms")) {
        for (const tl of el.querySelectorAll(".tl.tx")) {
          kids.push(new Paragraph({ spacing: { after: 60 },
            children: [new TextRun({ text: txt(tl), size: 19 })] }));
        }
      } else if (el.classList.contains("artw")) {
        const head = el.querySelector(".art"); const body = el.querySelector(".artp");
        if (head) kids.push(new Paragraph({ spacing: { before: 160, after: 40 },
          children: [new TextRun({ text: txt(head).replace(/[✎✕]/g, "").trim(), bold: true, size: 21 })] }));
        if (body) kids.push(new Paragraph({ spacing: { after: 60 },
          children: [new TextRun({ text: txt(body), size: 21 })] }));
      } else if (tag === "DIV" && el.classList.length === 0 && el.children.length) {
        // 조항 묶음 같은 무명 래퍼 — 안쪽을 그대로 걷는다(돈 표가 여기 산다)
        Array.from(el.children).forEach(emit);
      } else {
        const t = txt(el);
        if (t) kids.push(new Paragraph({
          alignment: el.classList.contains("dc-lead") || el.classList.contains("c")
            ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { after: 80 },
          children: [new TextRun({ text: t, bold: el.classList.contains("sect") || el.classList.contains("big"), size: 21 })],
        }));
      }
    };
    Array.from(cl.children).forEach(emit);
    kids.push(new Paragraph({ children: [], pageBreakBefore: true }));
  }
  kids.pop();
  const doc = new Document({
    styles: { default: { document: { run: { font: "바탕" } } } },
    sections: [{ properties: { page: { margin: { top: 794, bottom: 794, left: 680, right: 680 } } }, children: kids }],
  });
  const blob = await Packer.toBlob(doc);
  down(blob, `${fileBase}.docx`);
}

const down = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
