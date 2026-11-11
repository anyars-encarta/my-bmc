import type { components } from "./api.generated";

type Schemas = components["schemas"];

export type RegistryPagination = Schemas["Pagination"];
export type PatientSummary = Schemas["PatientSummary"];
export type PatientDetail = Schemas["PatientDetail"];
export type PatientChart = Schemas["PatientChart"];
export type PatientMergedPointer = Schemas["PatientMergedPointer"];
export type PatientReferences = Schemas["PatientReferences"];
export type DuplicateCandidate = Schemas["DuplicateCandidate"];
export type DuplicateCheckResult = Schemas["DuplicateCheckResult"];
export type PatientIdentifier = Schemas["PatientIdentifier"];
export type PatientContact = Schemas["PatientContact"];
export type PatientAllergy = Schemas["PatientAllergy"];
export type PatientCondition = Schemas["PatientCondition"];
export type PatientConsents = Schemas["PatientConsents"];
export type PatientTimelineEvent = Schemas["PatientTimelineEvent"];
export type PatientAuditEntry = Schemas["PatientAuditEntry"];
export type PatientPhotoResult = Schemas["PatientPhotoResult"];
export type DuplicatePair = Schemas["DuplicatePair"];
export type MergePreview = Schemas["MergePreview"];
export type MergeResult = Schemas["MergeResult"];
export type MergeSummary = Schemas["MergeSummary"];
export type MergeTask = Schemas["MergeTask"];
export type BreakGlassGrant = Schemas["BreakGlassGrant"];
export type BreakGlassReviewItem = Schemas["BreakGlassReviewItem"];

export type MergeableField = MergePreview["mergeableFields"][number];
export type PatientConsentType = Schemas["PatientConsentEntry"]["consentType"];
export type IdentifierType = Schemas["PatientIdentifierInput"]["idType"];
export type ContactType = Schemas["PatientContactInput"]["contactType"];
