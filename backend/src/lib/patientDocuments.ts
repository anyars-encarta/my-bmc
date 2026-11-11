import { encodeCode128 } from "./code128.js";
import { buildPdf, PdfPage } from "./simplePdf.js";

export type PatientPrintData = {
  facilityName: string;
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

/** 254 mm × 25.4 mm wristband with the Code 128 MRN and the two-identifier line. */
export const buildWristbandPdf = (data: PatientPrintData) => {
  const page = new PdfPage(254, 25.4);
  const modules = encodeCode128(data.mrn);
  const barcodeWidth = modules.length * MODULE_WIDTH_MM;
  const textLeft = 30;
  const barcodeLeft = 150;
  const textWidth = barcodeLeft - QUIET_ZONE_MM - textLeft - 2;

  page.text(textLeft, 8, bandName(data), { size: 12, bold: true, maxWidth: textWidth });
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

/** CR80 (85.6 mm × 54 mm) patient card with the Code 128 MRN. */
export const buildPatientCardPdf = (data: PatientPrintData) => {
  const width = 85.6;
  const page = new PdfPage(width, 54);
  const modules = encodeCode128(data.mrn);
  const barcodeWidth = modules.length * MODULE_WIDTH_MM;
  const barcodeLeft = (width - barcodeWidth) / 2;

  page.rect(0, 0, width, 11, 0.15);
  page.textColor(1);
  page.text(4, 5.2, data.facilityName, { size: 9, bold: true, maxWidth: width - 8 });
  page.text(4, 9, "PATIENT CARD", { size: 6 });
  page.textColor(0);

  page.text(4, 17.5, bandName(data), { size: 11, bold: true, maxWidth: width - 8 });
  page.text(4, 22.5, data.mrn, { size: 9, bold: true });
  page.text(4, 27, `${birthLine(data)}   ${sexLabel(data.sex)}`, { size: 8, maxWidth: width - 8 });
  if (data.bloodGroup) {
    page.text(width - 4, 22.5, `Blood group ${data.bloodGroup}`, { size: 8, align: "right" });
  }

  page.barcode(barcodeLeft, 31, modules, MODULE_WIDTH_MM, 13);
  page.text(width / 2, 47.5, data.mrn, { size: 7, align: "center" });
  page.text(width / 2, 51.5, "Bring this card to every visit.", { size: 6, align: "center" });

  return buildPdf([page], { title: `Patient card ${data.mrn}` });
};
