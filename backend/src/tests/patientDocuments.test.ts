import assert from "node:assert/strict";
import test from "node:test";

import { encodeCode128 } from "../lib/code128.js";
import { buildPatientCardPdf, buildWristbandPdf, type PatientPrintData } from "../lib/patientDocuments.js";

const printData: PatientPrintData = {
  facilityName: "Bolgatanga Medical Centre",
  firstName: "Kwame",
  middleName: "Yaw",
  lastName: "Mensah",
  mrn: "MRN-2026-000123",
  sex: "MALE",
  dateOfBirth: "1990-05-20",
  dobEstimated: false,
  ageYears: 36,
  bloodGroup: "O+",
  hasActiveAllergy: true,
  hasSevereAllergy: false,
  printedOn: "2026-10-12",
};

// Reference symbol produced by JsBarcode's CODE128B encoder for the same value.
const MRN_MODULES =
  "11010010000101110110001100010111010111000110100110111001100111001010011101100110011100101100111010010011011100100111011001001110110010011101100100111001101100111001011001011100101000011001100011101011";

test("Code 128 encodes an MRN with start B, checksum and stop symbols", () => {
  const modules = encodeCode128(printData.mrn);
  assert.equal(modules, MRN_MODULES);
  assert.equal(modules.length, (printData.mrn.length + 2) * 11 + 13);
  assert.ok(modules.startsWith("11010010000"));
  assert.ok(modules.endsWith("1100011101011"));
});

test("Code 128 rejects values outside code set B", () => {
  assert.throws(() => encodeCode128(""));
  assert.throws(() => encodeCode128("Kofi\u00e9"));
});

const assertValidPdf = (pdf: Buffer, widthPt: string, heightPt: string) => {
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.ok(text.includes(`/MediaBox [0 0 ${widthPt} ${heightPt}]`));

  const xrefOffset = Number(/startxref\n(\d+)\n/.exec(text)?.[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), "xref");
  const objectOffsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
  assert.ok(objectOffsets.length >= 7);
  objectOffsets.forEach((offset, index) => {
    assert.ok(text.slice(offset).startsWith(`${index + 1} 0 obj`), `object ${index + 1} offset`);
  });
  return text;
};

const hex = (value: string) => Buffer.from(value, "latin1").toString("hex");

test("the wristband PDF carries both identifiers, the barcode and the allergy flag", () => {
  const text = assertValidPdf(buildWristbandPdf(printData), "720", "72");
  assert.ok(text.includes(`<${hex("MENSAH, Kwame Yaw")}>`));
  assert.ok(text.includes(`<${hex("MRN-2026-000123")}>`));
  assert.ok(text.includes(`<${hex("DOB 20 May 1990 (36y)")}>`));
  assert.ok(text.includes(`<${hex("ALLERGY")}>`));
  assert.ok((text.match(/ re f /g) ?? []).length > 50, "barcode bars are drawn");

  const withoutAllergy = buildWristbandPdf({ ...printData, hasActiveAllergy: false }).toString("latin1");
  assert.equal(withoutAllergy.includes(`<${hex("ALLERGY")}>`), false);
});

test("the patient card PDF is CR80 sized and handles estimated ages", () => {
  const text = assertValidPdf(
    buildPatientCardPdf({ ...printData, dateOfBirth: null, dobEstimated: true, ageYears: 40 }),
    "242.646",
    "153.071",
  );
  assert.ok(text.includes(`<${hex("Bolgatanga Medical Centre")}>`));
  assert.ok(text.includes(`<${hex("Age ~40y   Male")}>`));
  assert.ok(text.includes(`<${hex("Blood group O+")}>`));
});

test("long names are shortened instead of overflowing the label", () => {
  const text = buildPatientCardPdf({
    ...printData,
    lastName: "Mensah-Agyemang Bonsu Acheampong Boateng",
    firstName: "Nana Kwabena Ofori",
  }).toString("latin1");
  assert.ok(text.includes(hex("MENSAH-AGYEMANG")));
  assert.ok(text.includes(`${hex("...")}>`));
  assert.equal(text.includes(hex("Nana Kwabena Ofori")), false);
});
