import { yearsBetween } from "@/lib/patient-format";
import type { ContactType, IdentifierType, PatientDetail } from "@/types/patients";

export type FieldErrors = Record<string, string[]>;

export type DemographicsForm = {
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  sex: string;
  ageMode: "DOB" | "ESTIMATE";
  dateOfBirth: string;
  dobEstimated: boolean;
  estimatedAgeYears: string;
  maritalStatus: string;
  nationality: string;
  religion: string;
  occupation: string;
  bloodGroup: string;
  phone: string;
  altPhone: string;
  email: string;
  addressLine: string;
  town: string;
  district: string;
  region: string;
  digitalAddress: string;
};

export const emptyDemographics = (): DemographicsForm => ({
  firstName: "",
  middleName: "",
  lastName: "",
  preferredName: "",
  sex: "",
  ageMode: "DOB",
  dateOfBirth: "",
  dobEstimated: false,
  estimatedAgeYears: "",
  maritalStatus: "",
  nationality: "Ghanaian",
  religion: "",
  occupation: "",
  bloodGroup: "",
  phone: "",
  altPhone: "",
  email: "",
  addressLine: "",
  town: "",
  district: "",
  region: "",
  digitalAddress: "",
});

export const demographicsFromPatient = (patient: PatientDetail): DemographicsForm => ({
  firstName: patient.firstName ?? "",
  middleName: patient.middleName ?? "",
  lastName: patient.lastName ?? "",
  preferredName: patient.preferredName ?? "",
  sex: patient.sex ?? "",
  ageMode: patient.dateOfBirth ? "DOB" : "ESTIMATE",
  dateOfBirth: patient.dateOfBirth ?? "",
  dobEstimated: patient.dateOfBirth ? patient.dobEstimated : false,
  estimatedAgeYears: patient.estimatedAgeYears === null ? "" : String(patient.estimatedAgeYears),
  maritalStatus: patient.maritalStatus ?? "",
  nationality: patient.nationality ?? "",
  religion: patient.religion ?? "",
  occupation: patient.occupation ?? "",
  bloodGroup: patient.bloodGroup ?? "",
  phone: patient.phone ?? "",
  altPhone: patient.altPhone ?? "",
  email: patient.email ?? "",
  addressLine: patient.addressLine ?? "",
  town: patient.town ?? "",
  district: patient.district ?? "",
  region: patient.region ?? "",
  digitalAddress: patient.digitalAddress ?? "",
});

const text = (value: string) => value.trim() || null;

export const toDemographicsPayload = (form: DemographicsForm) => {
  const known = form.ageMode === "DOB";
  const estimate = form.estimatedAgeYears.trim();
  return {
    firstName: form.firstName.trim(),
    middleName: text(form.middleName),
    lastName: form.lastName.trim(),
    preferredName: text(form.preferredName),
    sex: form.sex,
    dateOfBirth: known ? text(form.dateOfBirth) : null,
    dobEstimated: known ? form.dobEstimated : true,
    estimatedAgeYears: known || estimate === "" ? null : Number(estimate),
    maritalStatus: text(form.maritalStatus),
    nationality: text(form.nationality),
    religion: text(form.religion),
    occupation: text(form.occupation),
    bloodGroup: text(form.bloodGroup),
    phone: text(form.phone),
    altPhone: text(form.altPhone),
    email: text(form.email),
    addressLine: text(form.addressLine),
    town: text(form.town),
    district: text(form.district),
    region: text(form.region),
    digitalAddress: text(form.digitalAddress),
  };
};

export type DemographicsPayload = ReturnType<typeof toDemographicsPayload>;

/** Age implied by the form, or `null` while it is incomplete. */
export const formAgeYears = (form: DemographicsForm, today: string | undefined) => {
  if (form.ageMode === "ESTIMATE") {
    const value = Number(form.estimatedAgeYears);
    return form.estimatedAgeYears.trim() !== "" && Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth) || form.dateOfBirth > today) return null;
  return yearsBetween(form.dateOfBirth, today);
};

let rowCounter = 0;
const nextKey = () => {
  rowCounter += 1;
  return `row-${rowCounter}`;
};

export type IdentifierRow = {
  key: string;
  idType: IdentifierType;
  idValue: string;
  issuer: string;
  validTo: string;
};

export const newIdentifierRow = (idType: IdentifierType = "NHIS"): IdentifierRow => ({
  key: nextKey(),
  idType,
  idValue: "",
  issuer: "",
  validTo: "",
});

export const toIdentifierPayload = (rows: IdentifierRow[]) =>
  rows
    .filter((row) => row.idValue.trim())
    .map((row) => ({
      idType: row.idType,
      idValue: row.idValue.trim(),
      issuer: text(row.issuer),
      validTo: text(row.validTo),
    }));

export type ContactRow = {
  key: string;
  contactType: ContactType;
  name: string;
  relationship: string;
  phone: string;
  address: string;
  isPrimary: boolean;
  canConsent: boolean;
};

export const newContactRow = (contactType: ContactType = "NEXT_OF_KIN"): ContactRow => ({
  key: nextKey(),
  contactType,
  name: "",
  relationship: "",
  phone: "",
  address: "",
  isPrimary: false,
  canConsent: contactType === "GUARDIAN",
});

export const toContactPayload = (rows: ContactRow[]) =>
  rows
    .filter((row) => row.name.trim())
    .map((row) => ({
      contactType: row.contactType,
      name: row.name.trim(),
      relationship: text(row.relationship),
      phone: text(row.phone),
      address: text(row.address),
      isPrimary: row.isPrimary,
      canConsent: row.canConsent,
    }));
