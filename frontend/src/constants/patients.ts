import type { ContactType, IdentifierType, MergeableField, PatientConsentType } from "@/types/patients";

type Option<Value extends string = string> = { value: Value; label: string };

// Mirrors backend/src/lib/patientRules.ts. The API is authoritative; these only decide what to show.
export const PATIENT_READ_ROLES = [
  "super_admin",
  "registrar",
  "records_officer",
  "doctor",
  "nurse",
  "midwife",
  "dpo",
  "hospital_admin",
  "unit_manager",
  "cashier",
  "billing_officer",
  "pharmacist",
  "pharmacy_tech",
  "lab_scientist",
  "radiographer",
  "radiologist",
];
export const PATIENT_REGISTER_ROLES = ["super_admin", "registrar", "records_officer", "doctor"];
export const PATIENT_EDIT_ROLES = ["super_admin", "registrar", "records_officer"];
export const PATIENT_IDENTIFY_ROLES = ["super_admin", "registrar", "records_officer", "doctor"];
export const PATIENT_DEMOGRAPHIC_ITEM_ROLES = ["super_admin", "registrar", "records_officer", "doctor", "nurse", "midwife"];
export const PATIENT_ALLERGY_WRITE_ROLES = ["super_admin", "doctor", "nurse", "midwife", "pharmacist"];
export const PATIENT_CONDITION_WRITE_ROLES = ["super_admin", "doctor", "nurse", "midwife"];
export const PATIENT_CONSENT_WRITE_ROLES = ["super_admin", "registrar", "records_officer"];
export const PATIENT_PHOTO_ROLES = ["super_admin", "registrar", "records_officer"];
export const PATIENT_PRINT_ROLES = ["super_admin", "registrar", "records_officer", "doctor", "nurse", "midwife"];
export const PATIENT_TIMELINE_ROLES = ["super_admin", "doctor", "nurse", "midwife", "records_officer"];
export const PATIENT_MERGE_ROLES = ["super_admin", "records_officer"];
export const PATIENT_AUDIT_ROLES = ["super_admin", "records_officer", "dpo"];
export const BREAK_GLASS_REVIEW_READ_ROLES = ["super_admin", "dpo", "auditor", "unit_manager"];
export const BREAK_GLASS_REVIEW_WRITE_ROLES = ["super_admin", "dpo", "unit_manager"];

export const sexOptions: Option[] = [
  { value: "MALE", label: "Male" },
  { value: "FEMALE", label: "Female" },
  { value: "INTERSEX", label: "Intersex" },
  { value: "UNKNOWN", label: "Unknown" },
];

export const maritalStatusOptions: Option[] = [
  { value: "SINGLE", label: "Single" },
  { value: "MARRIED", label: "Married" },
  { value: "DIVORCED", label: "Divorced" },
  { value: "WIDOWED", label: "Widowed" },
  { value: "SEPARATED", label: "Separated" },
  { value: "OTHER", label: "Other" },
];

export const bloodGroupOptions: Option[] = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((value) => ({
  value,
  label: value,
}));

export const confidentialityOptions: Option[] = [
  { value: "NORMAL", label: "Normal" },
  { value: "RESTRICTED", label: "Restricted" },
  { value: "VIP", label: "VIP" },
];

export const patientStatusOptions: Option[] = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "DECEASED", label: "Deceased" },
];

export const identifierTypeOptions: Option<IdentifierType>[] = [
  { value: "NHIS", label: "NHIS number" },
  { value: "GHANA_CARD", label: "Ghana Card number" },
  { value: "PASSPORT", label: "Passport number" },
  { value: "DRIVERS_LICENCE", label: "Driver's licence number" },
  { value: "VOTER_ID", label: "Voter card number" },
  { value: "SSNIT", label: "SSNIT number" },
  { value: "STAFF_ID", label: "Employee ID" },
  { value: "EXTERNAL_MRN", label: "Other hospital record number" },
];

export const identifierHints: Record<IdentifierType, string> = {
  NHIS: "8 digits",
  GHANA_CARD: "GHA-123456789-0",
  PASSPORT: "6 to 12 letters and digits",
  DRIVERS_LICENCE: "As printed on the licence",
  VOTER_ID: "10 digits",
  SSNIT: "8 to 15 letters and digits",
  STAFF_ID: "As issued by HR",
  EXTERNAL_MRN: "As printed on the referring facility's card",
};

export const contactTypeOptions: Option<ContactType>[] = [
  { value: "NEXT_OF_KIN", label: "Next of kin" },
  { value: "EMERGENCY", label: "Emergency contact" },
  { value: "GUARDIAN", label: "Guardian" },
  { value: "EMPLOYER", label: "Employer" },
];

export const allergyCategoryOptions: Option[] = [
  { value: "DRUG", label: "Medicine" },
  { value: "FOOD", label: "Food" },
  { value: "LATEX", label: "Latex" },
  { value: "ENVIRON", label: "Environmental" },
  { value: "OTHER", label: "Other" },
];

export const allergySeverityOptions: Option[] = [
  { value: "MILD", label: "Mild" },
  { value: "MODERATE", label: "Moderate" },
  { value: "SEVERE", label: "Severe" },
  { value: "LIFE_THREATENING", label: "Life-threatening" },
];

export const clinicalItemStatusLabels: Record<string, string> = {
  ACTIVE: "Active",
  RESOLVED: "Resolved",
  ENTERED_IN_ERROR: "Entered in error",
};

export const consentTypeOptions: Option<PatientConsentType>[] = [
  { value: "TREATMENT", label: "Treatment" },
  { value: "DATA_PROCESSING", label: "Processing of personal data" },
  { value: "SMS_CONTACT", label: "SMS reminders and contact" },
  { value: "INSURER_SHARING", label: "Sharing with the insurer" },
  { value: "PHOTOGRAPHY", label: "Patient photograph" },
  { value: "RESEARCH", label: "Research use" },
];

export const REQUIRED_CONSENTS: PatientConsentType[] = ["TREATMENT", "DATA_PROCESSING"];
export const REGISTRATION_CONSENTS: PatientConsentType[] = [
  "TREATMENT",
  "DATA_PROCESSING",
  "SMS_CONTACT",
  "INSURER_SHARING",
  "PHOTOGRAPHY",
];

export const consentStatusOptions: Option[] = [
  { value: "GRANTED", label: "Granted" },
  { value: "DECLINED", label: "Declined" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];

export const consentStatusLabels: Record<string, string> = {
  GRANTED: "Granted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
  NOT_RECORDED: "Not recorded",
};

export const captureMethodOptions: Option[] = [
  { value: "PAPER", label: "Signed paper form" },
  { value: "ELECTRONIC", label: "Electronic signature" },
  { value: "VERBAL_WITNESSED", label: "Verbal, witnessed by staff" },
];

export const breakGlassOutcomeOptions: Option[] = [
  { value: "JUSTIFIED", label: "Justified" },
  { value: "UNJUSTIFIED", label: "Unjustified" },
  { value: "ESCALATED", label: "Escalated" },
];

export const duplicateReasonLabels: Record<string, string> = {
  IDENTIFIER: "Same identity document",
  NAME: "Similar name",
  DATE_OF_BIRTH: "Same date of birth",
  PHONE: "Same phone",
  SURNAME_SOUNDS_ALIKE: "Surname sounds alike",
};

export const mergeFieldLabels: Record<MergeableField, string> = {
  preferredName: "Preferred name",
  dateOfBirth: "Date of birth",
  maritalStatus: "Marital status",
  nationality: "Nationality",
  religion: "Religion",
  occupation: "Occupation",
  bloodGroup: "Blood group",
  phone: "Phone",
  altPhone: "Other phone",
  email: "Email",
  addressLine: "Address",
  town: "Town",
  district: "District",
  region: "Region",
  digitalAddress: "Digital address",
  photoUrl: "Photo",
};

export const mergeModuleLabels: Record<string, string> = {
  registry: "Consents and documents",
  appointments: "Appointments and visits",
  clinical: "Clinical records",
  laboratory: "Laboratory",
  radiology: "Radiology",
  admissions: "Admissions",
  nursing: "Nursing",
  pharmacy: "Pharmacy",
  billing: "Billing",
  insurance: "Insurance",
};

export const ghanaRegions = [
  "Ahafo",
  "Ashanti",
  "Bono",
  "Bono East",
  "Central",
  "Eastern",
  "Greater Accra",
  "North East",
  "Northern",
  "Oti",
  "Savannah",
  "Upper East",
  "Upper West",
  "Volta",
  "Western",
  "Western North",
];

export const optionLabel = (options: Option[], value: string | null | undefined) =>
  options.find((option) => option.value === value)?.label ?? value ?? "";
