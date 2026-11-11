const MM = 72 / 25.4;

// Helvetica advance widths (1/1000 em) for ASCII 32–126; used to fit and align text.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556,
  556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278,
  500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469,
  556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
  278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD_FACTOR = 1.08;

type TextOptions = { size: number; bold?: boolean; align?: "left" | "center" | "right"; maxWidth?: number };

const toWinAnsi = (value: string) =>
  Array.from(value.normalize("NFC"), (character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code <= 255 && !(code >= 127 && code <= 159) ? code : 63;
  });

const textWidthMm = (codes: number[], size: number, bold: boolean) => {
  const units = codes.reduce((sum, code) => sum + (HELVETICA_WIDTHS[code - 32] ?? 556), 0);
  return ((units / 1000) * size * (bold ? BOLD_FACTOR : 1)) / MM;
};

const number = (value: number) => Number(value.toFixed(3)).toString();

/** A single page addressed in millimetres from the top-left corner. */
export class PdfPage {
  readonly operations: string[] = [];

  constructor(
    readonly widthMm: number,
    readonly heightMm: number,
  ) {}

  private x(value: number) {
    return number(value * MM);
  }

  private y(value: number) {
    return number((this.heightMm - value) * MM);
  }

  /** Draws text with its baseline at `yMm`, shortening it with an ellipsis to fit `maxWidth`. */
  text(xMm: number, yMm: number, value: string, options: TextOptions) {
    const bold = options.bold ?? false;
    let codes = toWinAnsi(value);
    if (options.maxWidth !== undefined) {
      while (codes.length > 3 && textWidthMm(codes, options.size, bold) > options.maxWidth) {
        codes = [...codes.slice(0, -4), 46, 46, 46];
      }
    }
    const width = textWidthMm(codes, options.size, bold);
    const start =
      options.align === "center" ? xMm - width / 2 : options.align === "right" ? xMm - width : xMm;
    const hex = codes.map((code) => code.toString(16).padStart(2, "0")).join("");
    this.operations.push(
      `BT /${bold ? "F2" : "F1"} ${number(options.size)} Tf ${this.x(start)} ${this.y(yMm)} Td <${hex}> Tj ET`,
    );
    return this;
  }

  /** Fills a rectangle; `gray` runs from 0 (black) to 1 (white). */
  rect(xMm: number, yMm: number, widthMm: number, heightMm: number, gray = 0) {
    this.operations.push(
      `${number(gray)} g ${this.x(xMm)} ${this.y(yMm + heightMm)} ${number(widthMm * MM)} ${number(heightMm * MM)} re f 0 g`,
    );
    return this;
  }

  textColor(gray: number) {
    this.operations.push(`${number(gray)} g`);
    return this;
  }

  /** Draws a module string (`1` = bar) starting at `xMm`; returns the drawn width in mm. */
  barcode(xMm: number, yMm: number, modules: string, moduleWidthMm: number, heightMm: number) {
    let index = 0;
    while (index < modules.length) {
      if (modules[index] !== "1") {
        index += 1;
        continue;
      }
      let run = 1;
      while (modules[index + run] === "1") run += 1;
      this.rect(xMm + index * moduleWidthMm, yMm, run * moduleWidthMm, heightMm);
      index += run;
    }
    return modules.length * moduleWidthMm;
  }
}

const pdfString = (value: string) =>
  `<${toWinAnsi(value).map((code) => code.toString(16).padStart(2, "0")).join("")}>`;

/** Serialises pages into a minimal single-file PDF 1.4 document using the standard Helvetica fonts. */
export const buildPdf = (pages: PdfPage[], info: { title: string }) => {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");

  const objects: string[] = [];
  const pageObjectIds = pages.map((_page, index) => 5 + index * 2);

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index] ?? 5;
    const stream = page.operations.join("\n");
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(page.widthMm * MM)} ${number(page.heightMm * MM)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  const infoId = objects.length;
  objects[infoId] = `<< /Title ${pdfString(info.title)} /Producer ${pdfString("BMC HAMS")} >>`;

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
};
