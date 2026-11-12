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

type TextOptions = {
  size: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  maxWidth?: number;
  unicode?: boolean;
};

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

/** Converts a Unicode code point to WinAnsi, preserving the existing question-mark fallback. */
const toWinAnsiCode = (codePoint: number) => {
  if (codePoint >= 32 && codePoint <= 255 && !(codePoint >= 127 && codePoint <= 159)) return codePoint;
  return WIN_ANSI_EXTRA[codePoint] ?? 63;
};

/** Encodes a string into WinAnsi bytes for standard PDF text and metadata. */
const toWinAnsi = (value: string) =>
  Array.from(value.normalize("NFC"), (character) => toWinAnsiCode(character.codePointAt(0) ?? 63));

type TextGlyph = { font: "F1" | "F2" | "F3"; code: number; width: number };
type PdfImage = { name: string; bytes: Buffer; width: number; height: number };

/** Selects WinAnsi glyphs or Unicode CID glyphs for supported patient-name characters. */
const toTextGlyphs = (value: string, bold: boolean, unicode: boolean): TextGlyph[] =>
  Array.from(value.normalize("NFC"), (character) => {
    const codePoint = character.codePointAt(0) ?? 63;
    const winAnsiCode = toWinAnsiCode(codePoint);
    if (unicode && winAnsiCode === 63 && (/^\p{Script=Han}$/u.test(character) || codePoint === 0x0141 || codePoint === 0x0142)) {
      return { font: "F3", code: codePoint, width: 1000 };
    }
    return {
      font: bold ? "F2" : "F1",
      code: winAnsiCode,
      width: HELVETICA_WIDTHS[winAnsiCode - 32] ?? 556,
    };
  });

/** Estimates the line width in millimetres using the font-specific glyph advances. */
const textWidthMm = (glyphs: TextGlyph[], size: number) => {
  const units = glyphs.reduce((sum, glyph) => sum + glyph.width * (glyph.font === "F2" ? BOLD_FACTOR : 1), 0);
  return ((units / 1000) * size) / MM;
};

/** Encodes one Unicode code point as the UTF-16BE bytes required by the CID font. */
const utf16Hex = (codePoint: number) => {
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, "0");
  const value = codePoint - 0x10000;
  return `${(0xd800 + (value >> 10)).toString(16)}${(0xdc00 + (value & 0x3ff)).toString(16)}`;
};

const number = (value: number) => Number(value.toFixed(3)).toString();

/** A single page addressed in millimetres from the top-left corner. */
export class PdfPage {
  readonly operations: string[] = [];
  readonly images: PdfImage[] = [];

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
    const unicode = options.unicode ?? false;
    let glyphs = toTextGlyphs(value, bold, unicode);
    if (options.maxWidth !== undefined) {
      while (glyphs.length > 3 && textWidthMm(glyphs, options.size) > options.maxWidth) {
        glyphs = [...glyphs.slice(0, -4), ...toTextGlyphs("...", bold, unicode)];
      }
    }
    const width = textWidthMm(glyphs, options.size);
    const start =
      options.align === "center" ? xMm - width / 2 : options.align === "right" ? xMm - width : xMm;
    let cursor = start;
    let index = 0;
    while (index < glyphs.length) {
      const font = glyphs[index]?.font ?? (bold ? "F2" : "F1");
      const run: TextGlyph[] = [];
      while (glyphs[index]?.font === font) {
        const glyph = glyphs[index];
        if (!glyph) break;
        run.push(glyph);
        index += 1;
      }
      const hex = run
        .map((glyph) => (font === "F3" ? utf16Hex(glyph.code) : glyph.code.toString(16).padStart(2, "0")))
        .join("");
      this.operations.push(
        `BT /${font} ${number(options.size)} Tf ${this.x(cursor)} ${this.y(yMm)} Td <${hex}> Tj ET`,
      );
      cursor += textWidthMm(run, options.size);
    }
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

  /** Draws a JPEG image into a top-left-origin box measured in millimetres. */
  image(xMm: number, yMm: number, widthMm: number, heightMm: number, image: Omit<PdfImage, "name">) {
    const name = `Im${this.images.length + 1}`;
    this.images.push({ ...image, name });
    this.operations.push(
      `q ${number(widthMm * MM)} 0 0 ${number(heightMm * MM)} ${this.x(xMm)} ${this.y(yMm + heightMm)} cm /${name} Do Q`,
    );
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

/** Serialises pages into a minimal PDF 1.4 document with Helvetica and a Unicode CID font. */
export const buildPdf = (pages: PdfPage[], info: { title: string }) => {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");

  const objects: string[] = [];
  const pageObjectIds = pages.map((_page, index) => 8 + index * 2);
  let nextObjectId = 8 + pages.length * 2;
  const imageObjectIds = pages.map((page) => page.images.map(() => nextObjectId++));

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  // Adobe's predefined CID font maps UTF-16BE text to its built-in GB1 character collection.
  objects[5] =
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>";
  objects[6] =
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /FontDescriptor 7 0 R >>";
  objects[7] =
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -250 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 /MissingWidth 1000 >>";

  pages.forEach((page, pageIndex) => {
    page.images.forEach((image, imageIndex) => {
      const objectId = imageObjectIds[pageIndex]?.[imageIndex];
      if (objectId === undefined) throw new Error("A PDF image object could not be assigned.");
      const bytes = image.bytes.toString("latin1");
      objects[objectId] =
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\n` +
        `stream\n${bytes}\nendstream`;
    });
  });

  pages.forEach((page, index) => {
    const pageId = pageObjectIds[index] ?? 8;
    const stream = page.operations.join("\n");
    const xobjects = page.images
      .map((image, imageIndex) => `/${image.name} ${imageObjectIds[index]?.[imageIndex]} 0 R`)
      .join(" ");
    const imageResources = xobjects ? `/XObject << ${xobjects} >>` : "";
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(page.widthMm * MM)} ${number(page.heightMm * MM)}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> ${imageResources} >> /Contents ${pageId + 1} 0 R >>`;
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
