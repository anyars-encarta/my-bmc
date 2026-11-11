import {
  BadgeCheck,
  BedDouble,
  CalendarClock,
  DoorOpen,
  FlaskConical,
  GitMerge,
  Lock,
  ScanLine,
  Stethoscope,
  UserRoundPlus,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  allergyCategoryOptions,
  allergySeverityOptions,
  bloodGroupOptions,
  captureMethodOptions,
  clinicalItemStatusLabels,
  consentStatusLabels,
  consentStatusOptions,
  consentTypeOptions,
  contactTypeOptions,
  identifierHints,
  identifierTypeOptions,
  maritalStatusOptions,
  optionLabel,
} from "@/constants/patients";
import { useLoader, usePatientReferences } from "@/hooks/use-registry";
import { formatDate, formatDateTime, humanize } from "@/lib/patient-format";
import { errorMessage, registryRequest, withQuery } from "@/lib/patients-api";
import type {
  ContactType,
  IdentifierType,
  PatientAllergy,
  PatientAuditEntry,
  PatientChart,
  PatientCondition,
  PatientConsents,
  PatientContact,
  PatientIdentifier,
  PatientPhotoResult,
  PatientTimelineEvent,
} from "@/types/patients";

import { Field, OptionSelect, PatientPhotoField } from "./form-parts";

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function TabCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function LoadState({ loading, error, empty, emptyText }: { loading: boolean; error: Error | null; empty: boolean; emptyText: string }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error.message}</p>;
  if (loading && empty) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (empty) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return null;
}

const statusVariant = (status: string) => (status === "ACTIVE" ? "default" : "secondary");

/** Runs a write, reports the outcome and returns whether it succeeded. */
const useAction = () => {
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(errorMessage(error, failure));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
};

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function DataItem({ label, value, redacted }: { label: string; value: string | null | undefined; redacted?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">
        {redacted ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-muted-foreground" tabIndex={0}>
                  — <Lock className="size-3" aria-hidden="true" />
                  <span className="sr-only">Not available to your role</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>Not available to your role</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          value || "—"
        )}
      </dd>
    </div>
  );
}

export function SummaryTab({
  patient,
  canPhoto,
  onPhotoSaved,
}: {
  patient: PatientChart;
  canPhoto: boolean;
  onPhotoSaved: (result: PatientPhotoResult) => void;
}) {
  const references = usePatientReferences();
  const hidden = (field: string) => patient.redacted.includes(field);
  const unitName = references?.units.find((unit) => unit.id === patient.registeredUnitId)?.name;

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <TabCard title="Demographics">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DataItem label="Phone" value={patient.phone} redacted={hidden("phone")} />
          <DataItem label="Other phone" value={patient.altPhone} redacted={hidden("altPhone")} />
          <DataItem label="Email" value={patient.email} redacted={hidden("email")} />
          <DataItem label="Address" value={patient.addressLine} redacted={hidden("addressLine")} />
          <DataItem label="Town" value={patient.town} redacted={hidden("town")} />
          <DataItem label="District" value={patient.district} redacted={hidden("district")} />
          <DataItem label="Region" value={patient.region} redacted={hidden("region")} />
          <DataItem label="Digital address" value={patient.digitalAddress} redacted={hidden("digitalAddress")} />
          <DataItem
            label="Marital status"
            value={optionLabel(maritalStatusOptions, patient.maritalStatus)}
            redacted={hidden("maritalStatus")}
          />
          <DataItem label="Nationality" value={patient.nationality} redacted={hidden("nationality")} />
          <DataItem label="Occupation" value={patient.occupation} redacted={hidden("occupation")} />
          <DataItem label="Religion" value={patient.religion} redacted={hidden("religion")} />
          <DataItem
            label="Blood group"
            value={optionLabel(bloodGroupOptions, patient.bloodGroup)}
            redacted={hidden("bloodGroup")}
          />
          <DataItem label="Registered" value={formatDateTime(patient.registeredAt)} />
          {patient.registeredUnitId ? <DataItem label="Registration unit" value={unitName} /> : null}
        </dl>
      </TabCard>
      <TabCard title="Photo">
        {canPhoto ? (
          <>
            <PatientPhotoField
              patientId={patient.id}
              photoUrl={patient.photoUrl}
              photoPublicId={patient.photoPublicId}
              onSaved={onPhotoSaved}
            />
            <p className="text-xs text-muted-foreground">
              A photo can only be saved when photography consent has been granted.
            </p>
          </>
        ) : patient.photoUrl ? (
          <img src={patient.photoUrl} alt={`Photo of ${patient.fullName}`} className="max-h-64 rounded-md border object-cover" />
        ) : (
          <p className="text-sm text-muted-foreground">No photo on record.</p>
        )}
      </TabCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

const TIMELINE_ICONS: Record<PatientTimelineEvent["type"], LucideIcon> = {
  REGISTRATION: UserRoundPlus,
  MERGE: GitMerge,
  APPOINTMENT: CalendarClock,
  VISIT: DoorOpen,
  ENCOUNTER: Stethoscope,
  ADMISSION: BedDouble,
  LAB_ORDER: FlaskConical,
  IMAGING_ORDER: ScanLine,
};

export function TimelineTab({ patientId }: { patientId: string }) {
  const { data, loading, error } = useLoader(
    () => registryRequest<PatientTimelineEvent[]>(`patients/${patientId}/timeline`).then((result) => result.data),
    [patientId],
  );
  const events = data ?? [];

  return (
    <TabCard title="Visits, encounters, results and admissions">
      <LoadState loading={loading} error={error} empty={events.length === 0} emptyText="Nothing has been recorded yet." />
      <ol className="space-y-3">
        {events.map((event, index) => {
          const Icon = TIMELINE_ICONS[event.type];
          return (
            <li key={`${event.type}-${event.occurredAt}-${index}`} className="flex gap-3 rounded-md border p-3 text-sm">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{event.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[formatDateTime(event.occurredAt), event.unitName, event.reference].filter(Boolean).join(" · ")}
                </p>
              </div>
              {event.status ? <Badge variant="outline">{humanize(event.status)}</Badge> : null}
            </li>
          );
        })}
      </ol>
    </TabCard>
  );
}

/* ------------------------------------------------------------------ */
/* Allergies                                                           */
/* ------------------------------------------------------------------ */

export function AllergiesTab({
  patientId,
  canWrite,
  today,
  onChanged,
}: {
  patientId: string;
  canWrite: boolean;
  today: string | undefined;
  onChanged: () => void;
}) {
  const base = `patients/${patientId}/allergies`;
  const { data, loading, error, reload } = useLoader(
    () => registryRequest<PatientAllergy[]>(base).then((result) => result.data),
    [patientId],
  );
  const { busy, run } = useAction();
  const [form, setForm] = useState({ category: "DRUG", substance: "", severity: "", reaction: "", notedOn: "" });
  const rows = data ?? [];
  const refresh = () => {
    reload();
    onChanged();
  };

  const add = async () => {
    const saved = await run(
      () =>
        registryRequest(base, {
          method: "POST",
          body: {
            category: form.category,
            substance: form.substance.trim(),
            severity: form.severity || null,
            reaction: form.reaction.trim() || null,
            notedOn: form.notedOn || null,
          },
        }),
      "Allergy recorded.",
      "The allergy could not be saved.",
    );
    if (saved) {
      setForm({ category: "DRUG", substance: "", severity: "", reaction: "", notedOn: "" });
      refresh();
    }
  };

  const setStatus = async (row: PatientAllergy, status: string) => {
    const saved = await run(
      () => registryRequest(`${base}/${row.id}`, { method: "PATCH", body: { status } }),
      "Allergy updated.",
      "The allergy could not be updated.",
    );
    if (saved) refresh();
  };

  return (
    <TabCard title="Allergies">
      {canWrite ? (
        <form
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-[1fr_1.4fr_1fr_1.4fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field label="Type" htmlFor="allergy-category">
            <OptionSelect
              id="allergy-category"
              value={form.category}
              onChange={(category) => setForm({ ...form, category })}
              options={allergyCategoryOptions}
            />
          </Field>
          <Field label="Substance" htmlFor="allergy-substance" required>
            <Input
              id="allergy-substance"
              value={form.substance}
              maxLength={150}
              onChange={(event) => setForm({ ...form, substance: event.target.value })}
            />
          </Field>
          <Field label="Severity" htmlFor="allergy-severity">
            <OptionSelect
              id="allergy-severity"
              value={form.severity}
              onChange={(severity) => setForm({ ...form, severity })}
              options={allergySeverityOptions}
              emptyLabel="Not known"
            />
          </Field>
          <Field label="Reaction" htmlFor="allergy-reaction">
            <Input
              id="allergy-reaction"
              value={form.reaction}
              maxLength={200}
              onChange={(event) => setForm({ ...form, reaction: event.target.value })}
            />
          </Field>
          <Field label="First noted" htmlFor="allergy-noted">
            <Input
              id="allergy-noted"
              type="date"
              max={today}
              value={form.notedOn}
              onChange={(event) => setForm({ ...form, notedOn: event.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !form.substance.trim()}>
              Add allergy
            </Button>
          </div>
        </form>
      ) : null}

      <LoadState loading={loading} error={error} empty={rows.length === 0} emptyText="No allergies recorded." />
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Substance</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Reaction</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Status</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.substance}</TableCell>
                <TableCell>{optionLabel(allergyCategoryOptions, row.category)}</TableCell>
                <TableCell>
                  {row.severity ? (
                    <Badge variant={["SEVERE", "LIFE_THREATENING"].includes(row.severity) ? "destructive" : "secondary"}>
                      {optionLabel(allergySeverityOptions, row.severity)}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>{row.reaction ?? "—"}</TableCell>
                <TableCell>
                  {formatDate(row.recordedAt)}
                  {row.recordedByName ? <span className="block text-xs text-muted-foreground">{row.recordedByName}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{clinicalItemStatusLabels[row.status] ?? row.status}</Badge>
                </TableCell>
                {canWrite ? (
                  <TableCell className="space-x-2 text-right">
                    {row.status === "ACTIVE" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "RESOLVED")}>
                          Resolved
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "ENTERED_IN_ERROR")}>
                          Entered in error
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "ACTIVE")}>
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </TabCard>
  );
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

export function ConditionsTab({
  patientId,
  canWrite,
  today,
}: {
  patientId: string;
  canWrite: boolean;
  today: string | undefined;
}) {
  const base = `patients/${patientId}/conditions`;
  const { data, loading, error, reload } = useLoader(
    () => registryRequest<PatientCondition[]>(base).then((result) => result.data),
    [patientId],
  );
  const { busy, run } = useAction();
  const [form, setForm] = useState({ description: "", icd10Code: "", onsetDate: "", isChronic: false });
  const rows = data ?? [];

  const add = async () => {
    const saved = await run(
      () =>
        registryRequest(base, {
          method: "POST",
          body: {
            description: form.description.trim(),
            icd10Code: form.icd10Code.trim() || null,
            onsetDate: form.onsetDate || null,
            isChronic: form.isChronic,
          },
        }),
      "Condition recorded.",
      "The condition could not be saved.",
    );
    if (saved) {
      setForm({ description: "", icd10Code: "", onsetDate: "", isChronic: false });
      reload();
    }
  };

  const setStatus = async (row: PatientCondition, status: string) => {
    const saved = await run(
      () => registryRequest(`${base}/${row.id}`, { method: "PATCH", body: { status } }),
      "Condition updated.",
      "The condition could not be updated.",
    );
    if (saved) reload();
  };

  return (
    <TabCard title="Conditions and problem list">
      {canWrite ? (
        <form
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_auto_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field label="Condition" htmlFor="condition-description" required>
            <Input
              id="condition-description"
              value={form.description}
              maxLength={200}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label="ICD-10 code" htmlFor="condition-icd" hint="Optional, e.g. E11">
            <Input
              id="condition-icd"
              value={form.icd10Code}
              maxLength={10}
              onChange={(event) => setForm({ ...form, icd10Code: event.target.value })}
            />
          </Field>
          <Field label="Onset" htmlFor="condition-onset">
            <Input
              id="condition-onset"
              type="date"
              max={today}
              value={form.onsetDate}
              onChange={(event) => setForm({ ...form, onsetDate: event.target.value })}
            />
          </Field>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="condition-chronic"
              checked={form.isChronic}
              onCheckedChange={(checked) => setForm({ ...form, isChronic: checked === true })}
            />
            <Label htmlFor="condition-chronic" className="font-normal">Chronic</Label>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !form.description.trim()}>
              Add condition
            </Button>
          </div>
        </form>
      ) : null}

      <LoadState loading={loading} error={error} empty={rows.length === 0} emptyText="No conditions recorded." />
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Condition</TableHead>
              <TableHead>ICD-10</TableHead>
              <TableHead>Onset</TableHead>
              <TableHead>Recorded</TableHead>
              <TableHead>Status</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {row.description}
                  {row.isChronic ? <Badge variant="outline" className="ml-2">Chronic</Badge> : null}
                </TableCell>
                <TableCell>{row.icd10Code ?? "—"}</TableCell>
                <TableCell>{formatDate(row.onsetDate)}</TableCell>
                <TableCell>
                  {formatDate(row.recordedAt)}
                  {row.recordedByName ? <span className="block text-xs text-muted-foreground">{row.recordedByName}</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{clinicalItemStatusLabels[row.status] ?? row.status}</Badge>
                </TableCell>
                {canWrite ? (
                  <TableCell className="space-x-2 text-right">
                    {row.status === "ACTIVE" ? (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "RESOLVED")}>
                          Resolved
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "ENTERED_IN_ERROR")}>
                          Entered in error
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(row, "ACTIVE")}>
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </TabCard>
  );
}

/* ------------------------------------------------------------------ */
/* Identity documents                                                  */
/* ------------------------------------------------------------------ */

export function IdentifiersTab({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `patients/${patientId}/identifiers`;
  const { data, loading, error, reload } = useLoader(
    () => registryRequest<PatientIdentifier[]>(base).then((result) => result.data),
    [patientId],
  );
  const { busy, run } = useAction();
  const [form, setForm] = useState<{ idType: IdentifierType; idValue: string; issuer: string; validTo: string }>({
    idType: "NHIS",
    idValue: "",
    issuer: "",
    validTo: "",
  });
  const rows = data ?? [];

  const add = async () => {
    const saved = await run(
      () =>
        registryRequest(base, {
          method: "POST",
          body: {
            idType: form.idType,
            idValue: form.idValue.trim(),
            issuer: form.issuer.trim() || null,
            validTo: form.validTo || null,
          },
        }),
      "Identity document added.",
      "The identity document could not be saved.",
    );
    if (saved) {
      setForm({ idType: form.idType, idValue: "", issuer: "", validTo: "" });
      reload();
    }
  };

  const patch = async (row: PatientIdentifier, body: Record<string, unknown>, success: string) => {
    const saved = await run(
      () => registryRequest(`${base}/${row.id}`, { method: "PATCH", body }),
      success,
      "The identity document could not be updated.",
    );
    if (saved) reload();
  };

  return (
    <TabCard title="Identity documents">
      {canWrite ? (
        <form
          className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Field label="Document type" htmlFor="identifier-type">
            <OptionSelect
              id="identifier-type"
              value={form.idType}
              onChange={(idType) => setForm({ ...form, idType: idType as IdentifierType })}
              options={identifierTypeOptions}
            />
          </Field>
          <Field label="Number" htmlFor="identifier-value" required hint={identifierHints[form.idType]}>
            <Input
              id="identifier-value"
              value={form.idValue}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => setForm({ ...form, idValue: event.target.value })}
            />
          </Field>
          <Field label="Issued by" htmlFor="identifier-issuer">
            <Input
              id="identifier-issuer"
              value={form.issuer}
              maxLength={100}
              onChange={(event) => setForm({ ...form, issuer: event.target.value })}
            />
          </Field>
          <Field label="Valid until" htmlFor="identifier-valid">
            <Input
              id="identifier-valid"
              type="date"
              value={form.validTo}
              onChange={(event) => setForm({ ...form, validTo: event.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={busy || !form.idValue.trim()}>
              Add document
            </Button>
          </div>
        </form>
      ) : null}

      <LoadState loading={loading} error={error} empty={rows.length === 0} emptyText="No identity documents recorded." />
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Number</TableHead>
              <TableHead>Issued by</TableHead>
              <TableHead>Valid until</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead>Status</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{optionLabel(identifierTypeOptions, row.idType)}</TableCell>
                <TableCell className="font-mono">{row.idValue}</TableCell>
                <TableCell>{row.issuer ?? "—"}</TableCell>
                <TableCell>{formatDate(row.validTo)}</TableCell>
                <TableCell>
                  {row.verified ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <BadgeCheck className="size-4" aria-hidden="true" /> Verified
                      {row.verifiedByName ? ` by ${row.verifiedByName}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not verified</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(row.status)}>{humanize(row.status)}</Badge>
                </TableCell>
                {canWrite ? (
                  <TableCell className="space-x-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void patch(row, { verified: !row.verified }, row.verified ? "Verification removed." : "Document verified.")}
                    >
                      {row.verified ? "Remove verification" : "Mark verified"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void patch(
                          row,
                          { status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
                          row.status === "ACTIVE" ? "Document deactivated." : "Document reactivated.",
                        )
                      }
                    >
                      {row.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </TabCard>
  );
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

type ContactForm = {
  contactType: ContactType;
  name: string;
  relationship: string;
  phone: string;
  address: string;
  isPrimary: boolean;
  canConsent: boolean;
};

const emptyContact = (): ContactForm => ({
  contactType: "NEXT_OF_KIN",
  name: "",
  relationship: "",
  phone: "",
  address: "",
  isPrimary: false,
  canConsent: false,
});

export function ContactsTab({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `patients/${patientId}/contacts`;
  const { data, loading, error, reload } = useLoader(
    () => registryRequest<PatientContact[]>(base).then((result) => result.data),
    [patientId],
  );
  const { busy, run } = useAction();
  const [form, setForm] = useState<ContactForm>(emptyContact);
  const [editing, setEditing] = useState<PatientContact | null>(null);
  const rows = data ?? [];

  const save = async () => {
    const body = {
      contactType: form.contactType,
      name: form.name.trim(),
      relationship: form.relationship.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      isPrimary: form.isPrimary,
      canConsent: form.canConsent,
    };
    const saved = await run(
      () => registryRequest(editing ? `${base}/${editing.id}` : base, { method: editing ? "PATCH" : "POST", body }),
      editing ? "Contact updated." : "Contact added.",
      "The contact could not be saved.",
    );
    if (saved) {
      setForm(emptyContact());
      setEditing(null);
      reload();
    }
  };

  const startEdit = (row: PatientContact) => {
    setEditing(row);
    setForm({
      contactType: row.contactType,
      name: row.name,
      relationship: row.relationship ?? "",
      phone: row.phone ?? "",
      address: row.address ?? "",
      isPrimary: row.isPrimary,
      canConsent: row.canConsent,
    });
  };

  const remove = async (row: PatientContact) => {
    const saved = await run(
      () => registryRequest(`${base}/${row.id}`, { method: "DELETE" }),
      "Contact removed.",
      "The contact could not be removed.",
    );
    if (saved) {
      if (editing?.id === row.id) {
        setEditing(null);
        setForm(emptyContact());
      }
      reload();
    }
  };

  return (
    <TabCard title="Contact people">
      {canWrite ? (
        <form
          className="space-y-3 rounded-md border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p className="text-sm font-medium">{editing ? `Editing ${editing.name}` : "Add a contact person"}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Contact type" htmlFor="contact-type">
              <OptionSelect
                id="contact-type"
                value={form.contactType}
                onChange={(contactType) => setForm({ ...form, contactType: contactType as ContactType })}
                options={contactTypeOptions}
              />
            </Field>
            <Field label="Full name" htmlFor="contact-name" required>
              <Input id="contact-name" value={form.name} maxLength={150} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Relationship" htmlFor="contact-relationship">
              <Input
                id="contact-relationship"
                value={form.relationship}
                maxLength={40}
                onChange={(event) => setForm({ ...form, relationship: event.target.value })}
              />
            </Field>
            <Field label="Phone" htmlFor="contact-phone">
              <Input
                id="contact-phone"
                type="tel"
                inputMode="tel"
                value={form.phone}
                maxLength={25}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor="contact-address" className="sm:col-span-2 xl:col-span-4">
              <Input id="contact-address" value={form.address} maxLength={255} onChange={(event) => setForm({ ...form, address: event.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id="contact-primary" checked={form.isPrimary} onCheckedChange={(checked) => setForm({ ...form, isPrimary: checked === true })} />
              <Label htmlFor="contact-primary" className="font-normal">Main contact</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="contact-consent" checked={form.canConsent} onCheckedChange={(checked) => setForm({ ...form, canConsent: checked === true })} />
              <Label htmlFor="contact-consent" className="font-normal">Can give consent for the patient</Label>
            </div>
            <div className="ml-auto flex gap-2">
              {editing ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setForm(emptyContact());
                  }}
                >
                  Cancel
                </Button>
              ) : null}
              <Button type="submit" disabled={busy || !form.name.trim()}>
                {editing ? "Save contact" : "Add contact"}
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      <LoadState loading={loading} error={error} empty={rows.length === 0} emptyText="No contact people recorded." />
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Relationship</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Address</TableHead>
              {canWrite ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {row.name}
                  {row.isPrimary ? <Badge variant="outline" className="ml-2">Main</Badge> : null}
                  {row.canConsent ? <Badge variant="secondary" className="ml-2">Can consent</Badge> : null}
                </TableCell>
                <TableCell>{optionLabel(contactTypeOptions, row.contactType)}</TableCell>
                <TableCell>{row.relationship ?? "—"}</TableCell>
                <TableCell>{row.phone ?? "—"}</TableCell>
                <TableCell>{row.address ?? "—"}</TableCell>
                {canWrite ? (
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(row)}>
                      Remove
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </TabCard>
  );
}

/* ------------------------------------------------------------------ */
/* Consents                                                            */
/* ------------------------------------------------------------------ */

export function ConsentsTab({
  patientId,
  canWrite,
  isMinor,
  onChanged,
}: {
  patientId: string;
  canWrite: boolean;
  isMinor: boolean;
  onChanged: () => void;
}) {
  const base = `patients/${patientId}/consents`;
  const references = usePatientReferences();
  const { data, loading, error, reload } = useLoader(
    () => registryRequest<PatientConsents>(base).then((result) => result.data),
    [patientId],
  );
  const { busy, run } = useAction();
  const emptyForm = {
    consentType: "SMS_CONTACT",
    status: "GRANTED",
    captureMethod: "PAPER",
    witness: "",
    guardianName: "",
    guardianRelationship: "",
    note: "",
  };
  const [form, setForm] = useState(emptyForm);
  const verbal = form.captureMethod === "VERBAL_WITNESSED";

  const save = async () => {
    const saved = await run(
      () =>
        registryRequest(base, {
          method: "POST",
          body: {
            consentType: form.consentType,
            status: form.status,
            captureMethod: form.captureMethod,
            witnessStaffId: verbal ? form.witness || null : null,
            guardianName: form.guardianName.trim() || null,
            guardianRelationship: form.guardianRelationship.trim() || null,
            note: form.note.trim() || null,
          },
        }),
      "Consent recorded.",
      "The consent could not be saved.",
    );
    if (saved) {
      setForm({ ...emptyForm, consentType: form.consentType });
      reload();
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <TabCard title="Current consents">
        <LoadState loading={loading} error={error} empty={!data} emptyText="No consents recorded." />
        {data ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.effective.map((entry) => (
              <div key={entry.consentType} className="rounded-md border p-3">
                <dt className="text-sm font-medium">{optionLabel(consentTypeOptions, entry.consentType)}</dt>
                <dd className="mt-1 flex items-center gap-2 text-sm">
                  <Badge
                    variant={
                      entry.status === "GRANTED" ? "default" : entry.status === "NOT_RECORDED" ? "outline" : "destructive"
                    }
                  >
                    {consentStatusLabels[entry.status] ?? entry.status}
                  </Badge>
                  {entry.recordedAt ? <span className="text-xs text-muted-foreground">{formatDate(entry.recordedAt)}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </TabCard>

      {canWrite ? (
        <TabCard title="Record a consent decision">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Consent for" htmlFor="consent-type">
                <OptionSelect
                  id="consent-type"
                  value={form.consentType}
                  onChange={(consentType) => setForm({ ...form, consentType })}
                  options={consentTypeOptions}
                />
              </Field>
              <Field label="Decision" htmlFor="consent-status">
                <OptionSelect
                  id="consent-status"
                  value={form.status}
                  onChange={(status) => setForm({ ...form, status })}
                  options={consentStatusOptions}
                />
              </Field>
              <Field label="How was it captured?" htmlFor="consent-capture">
                <OptionSelect
                  id="consent-capture"
                  value={form.captureMethod}
                  onChange={(captureMethod) => setForm({ ...form, captureMethod })}
                  options={captureMethodOptions}
                />
              </Field>
              {verbal ? (
                <Field label="Staff witness" required>
                  <SearchableSelect
                    value={form.witness}
                    onValueChange={(witness) => setForm({ ...form, witness })}
                    options={(references?.staff ?? []).map((person) => ({
                      value: person.id,
                      label: `${person.firstName} ${person.lastName} (${person.employeeId})`,
                    }))}
                    placeholder="Select the witness"
                    searchPlaceholder="Search by name or Employee ID..."
                    emptyMessage="No matching staff."
                  />
                </Field>
              ) : null}
              <Field
                label="Given by (guardian)"
                htmlFor="consent-guardian"
                hint={isMinor ? "The patient is a minor" : "Only when someone consents for the patient"}
              >
                <Input
                  id="consent-guardian"
                  value={form.guardianName}
                  maxLength={150}
                  onChange={(event) => setForm({ ...form, guardianName: event.target.value })}
                />
              </Field>
              <Field label="Guardian's relationship" htmlFor="consent-guardian-relationship">
                <Input
                  id="consent-guardian-relationship"
                  value={form.guardianRelationship}
                  maxLength={40}
                  onChange={(event) => setForm({ ...form, guardianRelationship: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Note" htmlFor="consent-note">
              <Textarea
                id="consent-note"
                rows={2}
                maxLength={500}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
              />
            </Field>
            <Button type="submit" disabled={busy || (verbal && !form.witness)}>
              Record consent
            </Button>
          </form>
        </TabCard>
      ) : null}

      <TabCard title="Consent history">
        {data && data.history.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Consent for</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Captured</TableHead>
                <TableHead>Given by</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                  <TableCell>{optionLabel(consentTypeOptions, row.consentType)}</TableCell>
                  <TableCell>{consentStatusLabels[row.status] ?? row.status}</TableCell>
                  <TableCell>
                    {optionLabel(captureMethodOptions, row.captureMethod)}
                    <span className="block text-xs text-muted-foreground">
                      {[row.capturedByName ? `by ${row.capturedByName}` : null, row.witnessName ? `witness ${row.witnessName}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.guardianName
                      ? `${row.guardianName}${row.guardianRelationship ? ` (${row.guardianRelationship})` : ""}`
                      : "Patient"}
                  </TableCell>
                  <TableCell>{row.policyVersion}</TableCell>
                  <TableCell>{row.note ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{loading ? "Loading..." : "No consent decisions recorded."}</p>
        )}
      </TabCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Removed",
  STATUS_CHANGE: "Status changed",
  READ_RESTRICTED: "Restricted record access",
  BREAK_GLASS: "Break-glass",
  PRINT: "Printed",
  OVERRIDE: "Override",
  APPROVE: "Approved",
  REJECT: "Rejected",
};

export function AuditTab({ patientId }: { patientId: string }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useLoader(
    () => registryRequest<PatientAuditEntry[]>(withQuery(`patients/${patientId}/audit`, { page, limit: 25 })),
    [patientId, page],
  );
  const rows = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <TabCard title="Audit trail">
      <LoadState loading={loading} error={error} empty={rows.length === 0} emptyText="No audit entries for this patient." />
      {rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">{formatDateTime(row.occurredAt)}</TableCell>
                <TableCell>
                  {row.actorName}
                  {row.actorRoles?.length ? (
                    <span className="block text-xs text-muted-foreground">{row.actorRoles.map(humanize).join(", ")}</span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge variant={["BREAK_GLASS", "READ_RESTRICTED", "OVERRIDE"].includes(row.action) ? "destructive" : "outline"}>
                    {AUDIT_ACTION_LABELS[row.action] ?? humanize(row.action)}
                  </Badge>
                </TableCell>
                <TableCell>{humanize(row.entityType)}</TableCell>
                <TableCell className="max-w-md whitespace-normal">{row.reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span className="text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!pagination.hasMore || loading} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </TabCard>
  );
}
