import { encodeCode128 } from "./code128.js";
import { buildPdf, PdfPage } from "./simplePdf.js";

export type PatientPrintData = {
  facilityName: string;
  facilityAddress: string | null;
  facilityTelephone: string | null;
  facilityEmail: string | null;
  facilityGpsDigitalAddress: string | null;
  logoImage?: { bytes: Buffer; width: number; height: number } | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  mrn: string;
  sex: string;
  dateOfBirth: string | null;
  dobEstimated: boolean;
  ageYears: number | null;
  bloodGroup: string | null;
  hasActiveAllergy: boolean;
  hasSevereAllergy: boolean;
  printedOn: string;
};

const FACILITY_LOGO_MAX_BYTES = 1_000_000;

/** Loads the configured Cloudinary logo as a bounded JPEG suitable for PDF embedding. */
export const loadFacilityLogo = async (logoUrl: string | null | undefined) => {
  if (!logoUrl) return null;

  const url = new URL(logoUrl);
  const uploadPath = "/image/upload/";
  const uploadIndex = url.pathname.indexOf(uploadPath);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "res.cloudinary.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    uploadIndex < 0
  ) {
    throw new Error("Facility logo must be an HTTPS Cloudinary image URL.");
  }

  url.pathname =
    `${url.pathname.slice(0, uploadIndex + uploadPath.length)}` +
    `f_jpg,w_512,h_512,c_pad,b_white/${url.pathname.slice(uploadIndex + uploadPath.length)}`;
  url.search = "";
  url.hash = "";

  const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "error" });
  if (!response.ok) throw new Error(`Facility logo could not be loaded (HTTP ${response.status}).`);
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("image/jpeg")) {
    throw new Error("Facility logo service returned an unsupported image format.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > FACILITY_LOGO_MAX_BYTES) throw new Error("Facility logo exceeds the size limit.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > FACILITY_LOGO_MAX_BYTES) throw new Error("Facility logo exceeds the size limit.");

  return { bytes, width: 512, height: 512 };
};

const MODULE_WIDTH_MM = 0.3;
const QUIET_ZONE_MM = MODULE_WIDTH_MM * 10;

const bandName = (data: PatientPrintData) =>
  `${data.lastName.toUpperCase()}, ${[data.firstName, data.middleName].filter(Boolean).join(" ")}`;

const formatDate = (iso: string) => {
  const [year, month, day] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[Number(month) - 1] ?? month} ${year}`;
};

const birthLine = (data: PatientPrintData) => {
  const age = data.ageYears === null ? "" : `${data.ageYears}y`;
  if (!data.dateOfBirth) return age ? `Age ~${age}` : "Age unknown";
  return `DOB ${formatDate(data.dateOfBirth)}${data.dobEstimated ? " (est.)" : ""}${age ? ` (${age})` : ""}`;
};

const sexLabel = (sex: string) => `${sex.charAt(0)}${sex.slice(1).toLowerCase()}`;

/** Wraps facility address text to a fixed number of printable lines. */
const wrapLines = (value: string, maxCharacters: number, maxLines: number) => {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const lastLine = lines[maxLines - 1];
    if (lastLine) lines[maxLines - 1] = `${lastLine.replace(/[.,\s]+$/u, "")}...`;
  }
  return lines;
};

/** 254 mm × 25.4 mm wristband with the Code 128 MRN and the two-identifier line. */
export const buildWristbandPdf = (data: PatientPrintData) => {
  const page = new PdfPage(254, 25.4);
  const modules = encodeCode128(data.mrn);
  const barcodeWidth = modules.length * MODULE_WIDTH_MM;
  const textLeft = 30;
  const barcodeLeft = 150;
  const textWidth = barcodeLeft - QUIET_ZONE_MM - textLeft - 2;

  page.text(textLeft, 8, bandName(data), { size: 12, bold: true, maxWidth: textWidth, unicode: true });
  page.text(textLeft, 13.5, `${data.mrn}   ${sexLabel(data.sex)}`, { size: 9, bold: true, maxWidth: textWidth });
  page.text(textLeft, 18, birthLine(data), { size: 8, maxWidth: textWidth });
  page.text(textLeft, 22, `${data.facilityName}  |  Printed ${formatDate(data.printedOn)}`, {
    size: 6,
    maxWidth: textWidth,
  });

  page.barcode(barcodeLeft, 4, modules, MODULE_WIDTH_MM, 14);
  page.text(barcodeLeft + barcodeWidth / 2, 21.5, data.mrn, { size: 7, align: "center" });

  if (data.hasActiveAllergy) {
    const flagLeft = barcodeLeft + barcodeWidth + QUIET_ZONE_MM + 2;
    page.rect(flagLeft, 6, 22, 12, 0);
    page.textColor(1);
    page.text(flagLeft + 11, 11.5, data.hasSevereAllergy ? "SEVERE" : "ALLERGY", {
      size: 8,
      bold: true,
      align: "center",
    });
    page.text(flagLeft + 11, 15.5, data.hasSevereAllergy ? "ALLERGY" : "ALERT", {
      size: 7,
      bold: true,
      align: "center",
    });
    page.textColor(0);
  }

  return buildPdf([page], { title: `Wristband ${data.mrn}` });
};

/** Two-sided CR80 (85.6 mm × 54 mm) patient card with return contact details. */
export const buildPatientCardPdf = (data: PatientPrintData) => {
  const width = 85.6;
  const page = new PdfPage(width, 54);
  const modules = encodeCode128(data.mrn);
  const barcodeWidth = modules.length * MODULE_WIDTH_MM;
  const barcodeLeft = (width - barcodeWidth) / 2;

  page.rect(0, 0, width, 11, 0.15);
  page.textColor(1);
  const headerTextLeft = data.logoImage ? 14 : 4;
  if (data.logoImage) page.image(3, 1, 9, 9, data.logoImage);
  page.text(headerTextLeft, 5.2, data.facilityName, {
    size: 9,
    bold: true,
    maxWidth: width - headerTextLeft - 4,
  });
  page.text(headerTextLeft, 9, "PATIENT CARD", { size: 6 });
  page.textColor(0);

  page.text(4, 17.5, bandName(data), { size: 11, bold: true, maxWidth: width - 8, unicode: true });
  page.text(4, 22.5, data.mrn, { size: 9, bold: true });
  page.text(4, 27, `${birthLine(data)}   ${sexLabel(data.sex)}`, { size: 8, maxWidth: width - 8 });
  if (data.bloodGroup) {
    page.text(width - 4, 22.5, `Blood group ${data.bloodGroup}`, { size: 8, align: "right" });
  }

  page.barcode(barcodeLeft, 31, modules, MODULE_WIDTH_MM, 13);
  page.text(width / 2, 47.5, data.mrn, { size: 7, align: "center" });
  page.text(width / 2, 51.5, "Bring this card to every visit.", { size: 6, align: "center" });

  const back = new PdfPage(width, 54);
  back.rect(0, 0, width, 54, 0.96);
  back.rect(0, 0, width, 10, 0.15);
  back.textColor(1);
  back.text(width / 2, 6.5, "IF FOUND, PLEASE RETURN TO", { size: 7, bold: true, align: "center" });
  back.textColor(0);
  back.text(width / 2, 18, data.facilityName, { size: 9, bold: true, align: "center", maxWidth: width - 8 });

  let returnDetailsY = 25;
  if (data.facilityAddress?.trim()) {
    const addressLines = wrapLines(data.facilityAddress.trim(), 58, 3);
    addressLines.forEach((line, index) => {
      back.text(width / 2, returnDetailsY, `${index === 0 ? "Address: " : ""}${line}`, {
        size: 5.5,
        align: "center",
        maxWidth: width - 12,
      });
      returnDetailsY += 3.2;
    });
  }
  for (const [label, value] of [
    ["Digital address", data.facilityGpsDigitalAddress],
    ["Tel", data.facilityTelephone],
    ["Email", data.facilityEmail],
  ] as const) {
    if (!value?.trim()) continue;
    back.text(width / 2, returnDetailsY, `${label}: ${value.trim()}`, {
      size: 5.5,
      align: "center",
      maxWidth: width - 12,
    });
    returnDetailsY += 3.2;
  }
  if (returnDetailsY === 25) {
    back.text(width / 2, 29, "Facility return contact details are not configured.", {
      size: 5.5,
      align: "center",
      maxWidth: width - 12,
    });
  }
  back.text(width / 2, 51, "Thank you for helping return this card.", { size: 5.5, align: "center" });

  return buildPdf([page, back], { title: `Patient card ${data.mrn}` });
};
