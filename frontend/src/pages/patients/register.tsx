import { CircleCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { DuplicateCandidateCard, DuplicatePanel } from "@/components/clinical/DuplicatePanel";
import { PatientPrintButtons } from "@/components/clinical/PatientPrintButtons";
import { PatientSearchPicker } from "@/components/clinical/PatientSearchPicker";
import { CreateView, CreateViewHeader } from "@/components/refine-ui/views/create-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import {
  PATIENT_PHOTO_ROLES,
  PATIENT_PRINT_ROLES,
  REGISTRATION_CONSENTS,
  REQUIRED_CONSENTS,
  captureMethodOptions,
  confidentialityOptions,
  consentTypeOptions,
  optionLabel,
  sexOptions,
} from "@/constants/patients";
import { useDebouncedValue, usePatientReferences, useRegistryAccess } from "@/hooks/use-registry";
import { ageSexLabel, formatDate } from "@/lib/patient-format";
import { RegistryError, errorMessage, registryRequest } from "@/lib/patients-api";
import { cn } from "@/lib/utils";
import type {
  DuplicateCandidate,
  DuplicateCheckResult,
  PatientChart,
  PatientConsentType,
  PatientDetail,
  PatientSummary,
} from "@/types/patients";

import {
  emptyDemographics,
  formAgeYears,
  toContactPayload,
  toDemographicsPayload,
  toIdentifierPayload,
  type ContactRow,
  type DemographicsForm,
  type FieldErrors,
  type IdentifierRow,
} from "./form-model";
import {
  ContactsEditor,
  DemographicsFields,
  Field,
  IdentifiersEditor,
  OptionSelect,
  PatientPhotoField,
} from "./form-parts";

type Mode = "register" | "identify";
type ConsentChoices = Record<PatientConsentType, string>;
type Conflict = { blocking: boolean; identifierInUse: boolean; candidates: DuplicateCandidate[] };

const STEPS = ["Patient details", "Documents & contacts", "Consent", "Review"] as const;
const consentChoiceOptions = [
  { value: "GRANTED", label: "Granted" },
  { value: "DECLINED", label: "Declined" },
];
const emptyConsents = (): ConsentChoices => ({
  TREATMENT: "",
  DATA_PROCESSING: "",
  SMS_CONTACT: "",
  INSURER_SHARING: "",
  PHOTOGRAPHY: "",
  RESEARCH: "",
});

const stepOfField = (field: string) => {
  if (field.startsWith("identifiers") || field.startsWith("contacts")) return 1;
  if (field.startsWith("consents") || field === "witnessStaffId" || field === "captureMethod") return 2;
  return 0;
};

export const PatientRegister = () => <RegistrationWizard mode="register" />;
export const PatientIdentify = () => <RegistrationWizard mode="identify" />;

function RegistrationWizard({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const { id: patientId } = useParams();
  const references = usePatientReferences();
  const { can } = useRegistryAccess();
  const today = references?.today;
  const minorAge = references?.minorAgeThreshold ?? 18;

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DemographicsForm>(emptyDemographics);
  const [confidentiality, setConfidentiality] = useState("NORMAL");
  const [unit, setUnit] = useState("");
  const [identifiers, setIdentifiers] = useState<IdentifierRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [consents, setConsents] = useState<ConsentChoices>(emptyConsents);
  const [captureMethod, setCaptureMethod] = useState("PAPER");
  const [witness, setWitness] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [created, setCreated] = useState<PatientDetail | null>(null);
  const [photo, setPhoto] = useState<{ url: string | null; publicId: string | null }>({ url: null, publicId: null });

  // Identify mode: the record being identified.
  const [target, setTarget] = useState<PatientChart | null>(null);
  const [targetError, setTargetError] = useState("");
  const [existing, setExisting] = useState<PatientSummary | null>(null);
  const [linkReason, setLinkReason] = useState("");
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (mode !== "identify" || !patientId) return;
    let active = true;
    registryRequest<PatientChart>(`patients/${patientId}`)
      .then((result) => {
        if (!active) return;
        if (!result.data.isUnidentified) {
          setTargetError("This patient has already been identified.");
          return;
        }
        setTarget(result.data);
        setForm((current) => ({
          ...current,
          sex: result.data.sex ?? "",
          ageMode: "ESTIMATE",
          estimatedAgeYears: result.data.estimatedAgeYears === null ? "" : String(result.data.estimatedAgeYears),
        }));
      })
      .catch((error: unknown) => {
        if (active) setTargetError(errorMessage(error, "The patient could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [mode, patientId]);

  const age = formAgeYears(form, today);
  const isMinor = age !== null && age < minorAge;
  const hasGuardian = contacts.some((row) => row.contactType === "GUARDIAN" && row.canConsent && row.name.trim());

  /* ---------------- Live duplicate check ---------------- */

  const identifierPayload = useMemo(() => toIdentifierPayload(identifiers), [identifiers]);
  const checkInput = useMemo(
    () =>
      JSON.stringify({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || null,
        lastName: form.lastName.trim(),
        dateOfBirth: form.ageMode === "DOB" && /^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth) ? form.dateOfBirth : null,
        phone: form.phone.trim() || null,
        identifiers: identifierPayload.map(({ idType, idValue }) => ({ idType, idValue })),
      }),
    [form.firstName, form.middleName, form.lastName, form.ageMode, form.dateOfBirth, form.phone, identifierPayload],
  );
  const debouncedCheck = useDebouncedValue(checkInput, 500);
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [checking, setChecking] = useState(false);
  const checkSequence = useRef(0);
  const checkReady = form.firstName.trim().length >= 2 && form.lastName.trim().length >= 2;

  useEffect(() => {
    const draft = JSON.parse(debouncedCheck) as { firstName: string; lastName: string };
    if (created || draft.firstName.length < 2 || draft.lastName.length < 2) {
      setCandidates([]);
      return;
    }
    const sequence = ++checkSequence.current;
    setChecking(true);
    registryRequest<DuplicateCheckResult>("patients/duplicate-check", {
      method: "POST",
      body: { ...draft, excludePatientId: mode === "identify" ? patientId : null },
    })
      .then((result) => {
        if (sequence === checkSequence.current) setCandidates(result.data.candidates);
      })
      .catch(() => {
        if (sequence === checkSequence.current) setCandidates([]);
      })
      .finally(() => {
        if (sequence === checkSequence.current) setChecking(false);
      });
  }, [debouncedCheck, created, mode, patientId]);

  /* ---------------- Validation ---------------- */

  const stepProblems = (index: number): string[] => {
    const found: string[] = [];
    if (index === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) found.push("Enter the patient's first and last name.");
      if (!form.sex) found.push("Select the patient's sex.");
      if (form.ageMode === "DOB" && !form.dateOfBirth) found.push("Enter the date of birth, or estimate the age.");
      if (form.ageMode === "DOB" && today && form.dateOfBirth > today) found.push("The date of birth must be in the past.");
      if (form.ageMode === "ESTIMATE" && age === null) found.push("Enter an estimated age in whole years.");
    }
    if (index === 1) {
      const hasContactPerson = contacts.some((row) => row.contactType !== "EMPLOYER" && row.name.trim());
      if (!form.phone.trim() && !hasContactPerson) found.push("Capture the patient's phone number or a next of kin.");
      if (isMinor && !hasGuardian) found.push(`Patients under ${minorAge} need a guardian who can give consent.`);
      if (contacts.some((row) => !row.name.trim())) found.push("Enter a name for every contact person, or remove the empty row.");
      if (identifiers.some((row) => !row.idValue.trim())) found.push("Enter a number for every identity document, or remove the empty row.");
    }
    if (index === 2) {
      if (REQUIRED_CONSENTS.some((type) => consents[type] !== "GRANTED")) {
        found.push("Treatment and data-processing consent must both be granted to register the patient.");
      }
      if (captureMethod === "VERBAL_WITNESSED" && !witness) found.push("Choose the staff member who witnessed the verbal consent.");
    }
    return found;
  };

  const goTo = (next: number) => {
    for (let index = 0; index < next; index += 1) {
      const found = stepProblems(index);
      if (found.length > 0) {
        setProblems(found);
        setStep(index);
        return;
      }
    }
    setProblems([]);
    setStep(next);
  };

  /* ---------------- Submit ---------------- */

  const submit = async (acknowledge: boolean) => {
    setSaving(true);
    setErrors({});
    setProblems([]);
    const payload = {
      ...toDemographicsPayload(form),
      identifiers: identifierPayload,
      contacts: toContactPayload(contacts),
      consents: Object.entries(consents)
        .filter(([, status]) => status)
        .map(([consentType, status]) => ({ consentType, status })),
      captureMethod,
      witnessStaffId: captureMethod === "VERBAL_WITNESSED" ? witness || null : null,
      acknowledgeDuplicates: acknowledge,
      duplicateOverrideReason: acknowledge ? overrideReason.trim() || null : null,
    };
    try {
      const result =
        mode === "identify"
          ? await registryRequest<PatientDetail>(`patients/${patientId}/identify`, {
              method: "POST",
              body: { ...payload, version: target?.version },
            })
          : await registryRequest<PatientDetail>("patients", {
              method: "POST",
              body: { ...payload, confidentiality, registeredUnitId: unit || null },
            });
      setConflict(null);
      setCreated(result.data);
      setPhoto({ url: result.data.photoUrl, publicId: result.data.photoPublicId ?? null });
      toast.success(mode === "identify" ? "Patient identified." : `Patient registered as ${result.data.mrn}.`);
    } catch (error) {
      if (error instanceof RegistryError && error.code === "PATIENT_DUPLICATE_CANDIDATES") {
        const details = error.details as { blocking?: boolean; candidates?: DuplicateCandidate[] };
        setConflict({ blocking: details.blocking === true, identifierInUse: false, candidates: details.candidates ?? [] });
      } else if (error instanceof RegistryError && error.code === "PATIENT_IDENTIFIER_IN_USE") {
        const details = error.details as { candidates?: DuplicateCandidate[] } | undefined;
        setConflict({ blocking: true, identifierInUse: true, candidates: details?.candidates ?? [] });
      } else if (error instanceof RegistryError && error.code === "PATIENT_DUPLICATE_REASON_REQUIRED") {
        toast.error(error.message);
      } else {
        const fieldErrors = error instanceof RegistryError ? error.fieldErrors : {};
        const firstField = Object.keys(fieldErrors)[0];
        setConflict(null);
        setErrors(fieldErrors);
        setProblems([errorMessage(error, "The patient could not be saved.")]);
        if (firstField) setStep(stepOfField(firstField));
      }
    } finally {
      setSaving(false);
    }
  };

  const linkToExisting = async () => {
    if (!existing || linkReason.trim().length < 10) return;
    setLinking(true);
    try {
      await registryRequest(`patients/${patientId}/identify`, {
        method: "POST",
        body: { mergeIntoPatientId: existing.id, reason: linkReason.trim() },
      });
      toast.success("The unidentified record was merged into the existing patient.");
      navigate(`/patients/show/${existing.id}`);
    } catch (error) {
      toast.error(errorMessage(error, "The records could not be linked."));
    } finally {
      setLinking(false);
    }
  };

  const reset = () => {
    setStep(0);
    setForm(emptyDemographics());
    setConfidentiality("NORMAL");
    setIdentifiers([]);
    setContacts([]);
    setConsents(emptyConsents());
    setCaptureMethod("PAPER");
    setWitness("");
    setErrors({});
    setProblems([]);
    setOverrideReason("");
    setCreated(null);
  };

  const unitOptions = useMemo(
    () => [
      { value: "", label: "Not specified" },
      ...(references?.units ?? []).map((entry) => ({ value: entry.id, label: entry.name, keywords: entry.code })),
    ],
    [references],
  );
  const staffOptions = useMemo(
    () =>
      (references?.staff ?? []).map((person) => ({
        value: person.id,
        label: `${person.firstName} ${person.lastName} (${person.employeeId})`,
      })),
    [references],
  );
  const title = mode === "identify" ? "Identify patient" : "Register patient";

  if (targetError) {
    return (
      <CreateView className="space-y-4">
        <CreateViewHeader title={title} />
        <Alert variant="destructive">
          <AlertTitle>Cannot identify this patient</AlertTitle>
          <AlertDescription>{targetError}</AlertDescription>
        </Alert>
        <Button variant="outline" asChild>
          <Link to={patientId ? `/patients/show/${patientId}` : "/patients"}>Back to the chart</Link>
        </Button>
      </CreateView>
    );
  }

  if (created) {
    return (
      <CreateView className="space-y-4">
        <CreateViewHeader title={title} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CircleCheck className="size-5 text-emerald-600" aria-hidden="true" />
              {mode === "identify" ? "Patient identified" : "Patient registered"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-lg font-semibold">{created.fullName}</p>
              <p className="font-mono text-2xl font-bold tracking-wide">{created.mrn}</p>
              <p className="text-sm text-muted-foreground">{ageSexLabel(created)}</p>
            </div>
            {can(PATIENT_PHOTO_ROLES) ? (
              <div className="max-w-sm space-y-2">
                <Label>Patient photo</Label>
                {consents.PHOTOGRAPHY === "GRANTED" ? (
                  <PatientPhotoField
                    patientId={created.id}
                    photoUrl={photo.url}
                    photoPublicId={photo.publicId}
                    onSaved={(result) => setPhoto({ url: result.photoUrl, publicId: result.photoPublicId })}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Photography consent was not granted, so no photo can be taken.
                  </p>
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {can(PATIENT_PRINT_ROLES) ? <PatientPrintButtons patientId={created.id} /> : null}
              <Button asChild>
                <Link to={`/patients/show/${created.id}`}>Open chart</Link>
              </Button>
              {mode === "register" ? (
                <Button variant="outline" onClick={reset}>
                  Register another patient
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </CreateView>
    );
  }

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title={title} />

      {mode === "identify" && target ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Identifying {target.fullName} · <span className="font-mono">{target.mrn}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              If this person is already registered, link this record to the existing patient instead of
              entering the details again. Everything recorded so far moves to the existing record.
            </p>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Field label="Existing patient">
                <PatientSearchPicker value={existing} onChange={setExisting} excludePatientId={patientId} />
              </Field>
              <Field label="How was the identity confirmed?" htmlFor="link-reason" hint="At least 10 characters">
                <Textarea
                  id="link-reason"
                  rows={1}
                  maxLength={500}
                  value={linkReason}
                  onChange={(event) => setLinkReason(event.target.value)}
                />
              </Field>
              <div className="flex items-center">
                <Button
                  variant="outline"
                  disabled={!existing || linkReason.trim().length < 10 || linking}
                  onClick={() => void linkToExisting()}
                >
                  {linking ? "Linking..." : "Link to existing patient"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ol className="flex flex-wrap gap-2" aria-label="Registration steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              aria-current={index === step ? "step" : undefined}
              onClick={() => goTo(index)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
                index === step ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                index < step && "border-emerald-600 text-emerald-700 dark:text-emerald-400",
              )}
            >
              <span className="font-semibold">{index + 1}</span> {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{STEPS[step]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {problems.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>Please check the following</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {step === 0 ? (
              <>
                <DemographicsFields
                  form={form}
                  onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
                  errors={errors}
                  today={today}
                />
                {mode === "register" ? (
                  <fieldset className="grid gap-4 sm:grid-cols-2">
                    <legend className="mb-3 text-sm font-semibold">Record settings</legend>
                    <Field label="Registration unit" error={errors.registeredUnitId}>
                      <SearchableSelect
                        value={unit}
                        onValueChange={setUnit}
                        options={unitOptions}
                        placeholder="Select a unit"
                        searchPlaceholder="Search units and wards..."
                        emptyMessage="No matching unit."
                      />
                    </Field>
                    <Field
                      label="Confidentiality"
                      htmlFor="confidentiality"
                      hint="Restricted and VIP records can only be opened with a recorded reason."
                    >
                      <OptionSelect
                        id="confidentiality"
                        value={confidentiality}
                        onChange={setConfidentiality}
                        options={confidentialityOptions}
                      />
                    </Field>
                  </fieldset>
                ) : null}
              </>
            ) : null}

            {step === 1 ? (
              <>
                {isMinor ? (
                  <Alert>
                    <AlertTitle>This patient is a minor</AlertTitle>
                    <AlertDescription>
                      Add a guardian who can give consent. Their name is recorded on the consent.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Contact people</h3>
                  <ContactsEditor rows={contacts} onChange={setContacts} errors={errors} />
                </section>
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold">Identity documents</h3>
                  <IdentifiersEditor rows={identifiers} onChange={setIdentifiers} errors={errors} />
                </section>
              </>
            ) : null}

            {step === 2 ? (
              <>
                {errors.consents?.length ? (
                  <p className="text-sm text-destructive" role="alert">{errors.consents.join(" ")}</p>
                ) : null}
                <div className="space-y-3">
                  {REGISTRATION_CONSENTS.map((type) => {
                    const required = REQUIRED_CONSENTS.includes(type);
                    return (
                      <div
                        key={type}
                        className="grid items-center gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_12rem]"
                      >
                        <div>
                          <Label htmlFor={`consent-${type}`}>
                            {optionLabel(consentTypeOptions, type)}
                            {required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
                          </Label>
                          <p className="text-xs text-muted-foreground">{required ? "Required to register" : "Optional"}</p>
                        </div>
                        <OptionSelect
                          id={`consent-${type}`}
                          value={consents[type]}
                          onChange={(value) => setConsents((current) => ({ ...current, [type]: value }))}
                          options={consentChoiceOptions}
                          placeholder="Select the decision"
                          {...(required ? {} : { emptyLabel: "Not asked" })}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="How was consent captured?" htmlFor="capture-method">
                    <OptionSelect
                      id="capture-method"
                      value={captureMethod}
                      onChange={setCaptureMethod}
                      options={captureMethodOptions}
                    />
                  </Field>
                  {captureMethod === "VERBAL_WITNESSED" ? (
                    <Field label="Staff witness" required error={errors.witnessStaffId}>
                      <SearchableSelect
                        value={witness}
                        onValueChange={setWitness}
                        options={staffOptions}
                        placeholder="Select the witness"
                        searchPlaceholder="Search by name or Employee ID..."
                        emptyMessage="No matching staff."
                      />
                    </Field>
                  ) : null}
                </div>
                {isMinor ? (
                  <p className="text-sm text-muted-foreground">
                    Consent is being given on behalf of a minor by the guardian captured in the previous step.
                  </p>
                ) : null}
              </>
            ) : null}

            {step === 3 ? (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <ReviewItem label="Name" value={[form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ")} />
                <ReviewItem label="Sex" value={optionLabel(sexOptions, form.sex)} />
                <ReviewItem
                  label="Age"
                  value={
                    form.ageMode === "DOB"
                      ? `${formatDate(form.dateOfBirth)}${form.dobEstimated ? " (approx.)" : ""}${age === null ? "" : ` · ${age} y`}`
                      : `About ${form.estimatedAgeYears} years`
                  }
                />
                <ReviewItem label="Phone" value={form.phone} />
                <ReviewItem label="Address" value={[form.addressLine, form.town, form.region].filter(Boolean).join(", ")} />
                {mode === "register" ? (
                  <ReviewItem label="Confidentiality" value={optionLabel(confidentialityOptions, confidentiality)} />
                ) : null}
                <ReviewItem
                  label="Contact people"
                  value={contacts.filter((row) => row.name.trim()).map((row) => row.name.trim()).join(", ")}
                />
                <ReviewItem label="Identity documents" value={`${identifierPayload.length} captured`} />
                <ReviewItem
                  label="Consents granted"
                  value={Object.entries(consents)
                    .filter(([, status]) => status === "GRANTED")
                    .map(([type]) => optionLabel(consentTypeOptions, type))
                    .join(", ")}
                />
                <ReviewItem label="Possible duplicates" value={candidates.length === 0 ? "None found" : `${candidates.length} to review`} />
              </dl>
            ) : null}

            <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
              <Button variant="outline" disabled={step === 0 || saving} onClick={() => goTo(step - 1)}>
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={() => goTo(step + 1)}>Continue</Button>
              ) : (
                <Button
                  disabled={saving}
                  onClick={() => {
                    const found = [0, 1, 2].flatMap(stepProblems);
                    if (found.length > 0) {
                      goTo(STEPS.length - 1);
                      return;
                    }
                    void submit(false);
                  }}
                >
                  {saving ? "Saving..." : mode === "identify" ? "Identify patient" : "Register patient"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="order-first xl:sticky xl:top-20 xl:order-0">
          <DuplicatePanel candidates={candidates} checking={checking} ready={checkReady} />
        </div>
      </div>

      <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {conflict?.identifierInUse
                ? "This identity document is already registered"
                : conflict?.blocking
                  ? "This looks like an existing patient"
                  : "Similar patients found"}
            </DialogTitle>
            <DialogDescription>
              {conflict?.identifierInUse
                ? "An identity document you entered belongs to the patient below. Open the existing record instead of registering again."
                : conflict?.blocking
                  ? "Open the existing record if it is the same person. To register anyway, give a reason; it is recorded and reviewed by the records office."
                  : "Check the records below. If none of them is this patient, continue; your confirmation is recorded."}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {conflict?.candidates.map((candidate) => (
              <DuplicateCandidateCard key={candidate.patient.id} candidate={candidate} />
            ))}
          </ul>
          {conflict?.blocking && !conflict.identifierInUse ? (
            <Field label="Reason for registering a probable duplicate" htmlFor="override-reason" hint="At least 10 characters">
              <Textarea
                id="override-reason"
                rows={3}
                maxLength={500}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="e.g. Twin brother who shares the family phone number"
              />
            </Field>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflict(null)} disabled={saving}>
              Go back
            </Button>
            {conflict && !conflict.identifierInUse ? (
              <Button
                variant={conflict.blocking ? "destructive" : "default"}
                disabled={saving || (conflict.blocking && overrideReason.trim().length < 10)}
                onClick={() => void submit(true)}
              >
                {saving ? "Saving..." : conflict.blocking ? "Register anyway" : "None of these — continue"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CreateView>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}
