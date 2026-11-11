import { Plus, Trash2 } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";
import { toast } from "sonner";

import UploadWidget from "@/components/upload-widget";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  bloodGroupOptions,
  contactTypeOptions,
  ghanaRegions,
  identifierHints,
  identifierTypeOptions,
  maritalStatusOptions,
  sexOptions,
} from "@/constants/patients";
import { errorMessage, registryRequest } from "@/lib/patients-api";
import type { ContactType, IdentifierType, PatientPhotoResult } from "@/types/patients";
import type { UploadWidgetValue } from "@/types";

import {
  newContactRow,
  newIdentifierRow,
  type ContactRow,
  type DemographicsForm,
  type FieldErrors,
  type IdentifierRow,
} from "./form-model";

const NONE = "__none__";

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string[] | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
      </Label>
      {children}
      {error?.length ? (
        <p className="text-xs text-destructive" role="alert">
          {error.join(" ")}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Plain dropdown for short option lists. `emptyLabel` adds a "no value" choice. */
export function OptionSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select",
  emptyLabel,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value || (emptyLabel ? NONE : "")}
      onValueChange={(next) => onChange(next === NONE ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel ? <SelectItem value={NONE}>{emptyLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const regionOptions = [
  { value: "", label: "Not recorded" },
  ...ghanaRegions.map((region) => ({ value: region, label: region })),
];

export function DemographicsFields({
  form,
  onChange,
  errors,
  today,
  nameLocked,
}: {
  form: DemographicsForm;
  onChange: (patch: Partial<DemographicsForm>) => void;
  errors: FieldErrors;
  today: string | undefined;
  nameLocked?: boolean;
}) {
  const id = useId();
  const input = (
    name: keyof DemographicsForm,
    props: { maxLength: number; type?: string; inputMode?: "tel" | "email"; autoComplete?: string; disabled?: boolean },
  ) => (
    <Input
      id={`${id}-${name}`}
      value={form[name] as string}
      aria-invalid={errors[name]?.length ? true : undefined}
      onChange={(event) => onChange({ [name]: event.target.value })}
      {...props}
    />
  );

  return (
    <div className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Identity</legend>
        <Field label="First name" htmlFor={`${id}-firstName`} required error={errors.firstName}>
          {input("firstName", { maxLength: 100, autoComplete: "off", disabled: nameLocked })}
        </Field>
        <Field label="Last name" htmlFor={`${id}-lastName`} required error={errors.lastName}>
          {input("lastName", { maxLength: 100, autoComplete: "off", disabled: nameLocked })}
        </Field>
        <Field label="Middle name" htmlFor={`${id}-middleName`} error={errors.middleName}>
          {input("middleName", { maxLength: 100, autoComplete: "off", disabled: nameLocked })}
        </Field>
        <Field label="Preferred name" htmlFor={`${id}-preferredName`} error={errors.preferredName}>
          {input("preferredName", { maxLength: 100, autoComplete: "off" })}
        </Field>
        <Field label="Sex" htmlFor={`${id}-sex`} required error={errors.sex}>
          <OptionSelect
            id={`${id}-sex`}
            value={form.sex}
            onChange={(sex) => onChange({ sex })}
            options={sexOptions}
            placeholder="Select sex"
            invalid={Boolean(errors.sex?.length)}
          />
        </Field>
        <div className="space-y-2">
          <Label id={`${id}-age-mode`}>Age</Label>
          <RadioGroup
            aria-labelledby={`${id}-age-mode`}
            value={form.ageMode}
            onValueChange={(ageMode) => onChange({ ageMode: ageMode as DemographicsForm["ageMode"] })}
            className="flex flex-wrap gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="DOB" id={`${id}-age-dob`} />
              <Label htmlFor={`${id}-age-dob`} className="font-normal">Date of birth known</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="ESTIMATE" id={`${id}-age-estimate`} />
              <Label htmlFor={`${id}-age-estimate`} className="font-normal">Estimate the age</Label>
            </div>
          </RadioGroup>
        </div>
        {form.ageMode === "DOB" ? (
          <Field label="Date of birth" htmlFor={`${id}-dateOfBirth`} required error={errors.dateOfBirth}>
            <Input
              id={`${id}-dateOfBirth`}
              type="date"
              max={today}
              value={form.dateOfBirth}
              aria-invalid={errors.dateOfBirth?.length ? true : undefined}
              onChange={(event) => onChange({ dateOfBirth: event.target.value })}
            />
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id={`${id}-dobEstimated`}
                checked={form.dobEstimated}
                onCheckedChange={(checked) => onChange({ dobEstimated: checked === true })}
              />
              <Label htmlFor={`${id}-dobEstimated`} className="font-normal">This date is approximate</Label>
            </div>
          </Field>
        ) : (
          <Field
            label="Estimated age (years)"
            htmlFor={`${id}-estimatedAgeYears`}
            required
            error={errors.estimatedAgeYears ?? errors.dateOfBirth}
          >
            <Input
              id={`${id}-estimatedAgeYears`}
              type="number"
              min={0}
              max={130}
              step={1}
              value={form.estimatedAgeYears}
              onChange={(event) => onChange({ estimatedAgeYears: event.target.value })}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Contact</legend>
        <Field label="Phone" htmlFor={`${id}-phone`} error={errors.phone} hint="e.g. 024 412 3456">
          {input("phone", { maxLength: 25, type: "tel", inputMode: "tel" })}
        </Field>
        <Field label="Other phone" htmlFor={`${id}-altPhone`} error={errors.altPhone}>
          {input("altPhone", { maxLength: 25, type: "tel", inputMode: "tel" })}
        </Field>
        <Field label="Email" htmlFor={`${id}-email`} error={errors.email}>
          {input("email", { maxLength: 255, type: "email", inputMode: "email" })}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Address</legend>
        <Field label="Address" htmlFor={`${id}-addressLine`} error={errors.addressLine} className="sm:col-span-2">
          {input("addressLine", { maxLength: 200 })}
        </Field>
        <Field label="Town" htmlFor={`${id}-town`} error={errors.town}>
          {input("town", { maxLength: 100 })}
        </Field>
        <Field label="District" htmlFor={`${id}-district`} error={errors.district}>
          {input("district", { maxLength: 100 })}
        </Field>
        <Field label="Region" error={errors.region}>
          <SearchableSelect
            value={form.region}
            onValueChange={(region) => onChange({ region })}
            options={
              form.region && !ghanaRegions.includes(form.region)
                ? [...regionOptions, { value: form.region, label: form.region }]
                : regionOptions
            }
            placeholder="Select a region"
            searchPlaceholder="Search regions..."
            emptyMessage="No matching region."
          />
        </Field>
        <Field
          label="Digital address"
          htmlFor={`${id}-digitalAddress`}
          error={errors.digitalAddress}
          hint="GhanaPost GPS, e.g. GA-183-8164"
        >
          {input("digitalAddress", { maxLength: 20 })}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Other details</legend>
        <Field label="Marital status" htmlFor={`${id}-maritalStatus`} error={errors.maritalStatus}>
          <OptionSelect
            id={`${id}-maritalStatus`}
            value={form.maritalStatus}
            onChange={(maritalStatus) => onChange({ maritalStatus })}
            options={maritalStatusOptions}
            emptyLabel="Not recorded"
          />
        </Field>
        <Field label="Blood group" htmlFor={`${id}-bloodGroup`} error={errors.bloodGroup}>
          <OptionSelect
            id={`${id}-bloodGroup`}
            value={form.bloodGroup}
            onChange={(bloodGroup) => onChange({ bloodGroup })}
            options={bloodGroupOptions}
            emptyLabel="Not known"
          />
        </Field>
        <Field label="Nationality" htmlFor={`${id}-nationality`} error={errors.nationality}>
          {input("nationality", { maxLength: 60 })}
        </Field>
        <Field label="Occupation" htmlFor={`${id}-occupation`} error={errors.occupation}>
          {input("occupation", { maxLength: 100 })}
        </Field>
        <Field label="Religion" htmlFor={`${id}-religion`} error={errors.religion}>
          {input("religion", { maxLength: 40 })}
        </Field>
      </fieldset>
    </div>
  );
}

export function IdentifiersEditor({
  rows,
  onChange,
  errors,
}: {
  rows: IdentifierRow[];
  onChange: (rows: IdentifierRow[]) => void;
  errors: FieldErrors;
}) {
  const id = useId();
  const update = (key: string, patch: Partial<IdentifierRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const unusedType = identifierTypeOptions.find((option) => !rows.some((row) => row.idType === option.value))?.value;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No identity documents added.</p>
      ) : null}
      {rows.map((row, index) => (
        <div key={row.key} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]">
          <Field label="Document type" htmlFor={`${id}-${row.key}-type`} error={errors[`identifiers.${index}.idType`]}>
            <OptionSelect
              id={`${id}-${row.key}-type`}
              value={row.idType}
              onChange={(idType) => update(row.key, { idType: idType as IdentifierType })}
              options={identifierTypeOptions}
            />
          </Field>
          <Field
            label="Number"
            htmlFor={`${id}-${row.key}-value`}
            hint={identifierHints[row.idType]}
            error={errors[`identifiers.${index}.idValue`]}
          >
            <Input
              id={`${id}-${row.key}-value`}
              value={row.idValue}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => update(row.key, { idValue: event.target.value })}
            />
          </Field>
          <Field label="Issued by" htmlFor={`${id}-${row.key}-issuer`}>
            <Input
              id={`${id}-${row.key}-issuer`}
              value={row.issuer}
              maxLength={100}
              onChange={(event) => update(row.key, { issuer: event.target.value })}
            />
          </Field>
          <Field label="Valid until" htmlFor={`${id}-${row.key}-validTo`}>
            <Input
              id={`${id}-${row.key}-validTo`}
              type="date"
              value={row.validTo}
              onChange={(event) => update(row.key, { validTo: event.target.value })}
            />
          </Field>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Remove this document"
              onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={!unusedType}
        onClick={() => onChange([...rows, newIdentifierRow(unusedType)])}
      >
        <Plus aria-hidden="true" /> Add identity document
      </Button>
    </div>
  );
}

export function ContactsEditor({
  rows,
  onChange,
  errors,
}: {
  rows: ContactRow[];
  onChange: (rows: ContactRow[]) => void;
  errors: FieldErrors;
}) {
  const id = useId();
  const update = (key: string, patch: Partial<ContactRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-3">
      {errors.contacts?.length ? (
        <p className="text-sm text-destructive" role="alert">{errors.contacts.join(" ")}</p>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No contact people added.</p> : null}
      {rows.map((row, index) => (
        <div key={row.key} className="space-y-3 rounded-md border p-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Contact type" htmlFor={`${id}-${row.key}-type`}>
              <OptionSelect
                id={`${id}-${row.key}-type`}
                value={row.contactType}
                onChange={(contactType) =>
                  update(row.key, {
                    contactType: contactType as ContactType,
                    canConsent: contactType === "GUARDIAN" ? true : row.canConsent,
                  })
                }
                options={contactTypeOptions}
              />
            </Field>
            <Field label="Full name" htmlFor={`${id}-${row.key}-name`} required error={errors[`contacts.${index}.name`]}>
              <Input
                id={`${id}-${row.key}-name`}
                value={row.name}
                maxLength={150}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
            </Field>
            <Field label="Relationship" htmlFor={`${id}-${row.key}-relationship`} hint="e.g. Mother, Spouse">
              <Input
                id={`${id}-${row.key}-relationship`}
                value={row.relationship}
                maxLength={40}
                onChange={(event) => update(row.key, { relationship: event.target.value })}
              />
            </Field>
            <Field label="Phone" htmlFor={`${id}-${row.key}-phone`} error={errors[`contacts.${index}.phone`]}>
              <Input
                id={`${id}-${row.key}-phone`}
                type="tel"
                inputMode="tel"
                value={row.phone}
                maxLength={25}
                onChange={(event) => update(row.key, { phone: event.target.value })}
              />
            </Field>
            <Field label="Address" htmlFor={`${id}-${row.key}-address`} className="sm:col-span-2 xl:col-span-4">
              <Input
                id={`${id}-${row.key}-address`}
                value={row.address}
                maxLength={255}
                onChange={(event) => update(row.key, { address: event.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${row.key}-primary`}
                checked={row.isPrimary}
                onCheckedChange={(checked) => update(row.key, { isPrimary: checked === true })}
              />
              <Label htmlFor={`${id}-${row.key}-primary`} className="font-normal">Main contact</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-${row.key}-consent`}
                checked={row.canConsent}
                onCheckedChange={(checked) => update(row.key, { canConsent: checked === true })}
              />
              <Label htmlFor={`${id}-${row.key}-consent`} className="font-normal">
                Can give consent for the patient
              </Label>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onChange(rows.filter((entry) => entry.key !== row.key))}
            >
              <Trash2 aria-hidden="true" /> Remove
            </Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => onChange([...rows, newContactRow("NEXT_OF_KIN")])}>
          <Plus aria-hidden="true" /> Add next of kin
        </Button>
        <Button type="button" variant="outline" onClick={() => onChange([...rows, newContactRow("GUARDIAN")])}>
          <Plus aria-hidden="true" /> Add guardian
        </Button>
      </div>
    </div>
  );
}

/** Captures (camera or upload) and saves the patient photo. Saving needs photography consent. */
export function PatientPhotoField({
  patientId,
  photoUrl,
  photoPublicId,
  onSaved,
}: {
  patientId: string;
  photoUrl: string | null | undefined;
  photoPublicId: string | null | undefined;
  onSaved: (result: PatientPhotoResult) => void;
}) {
  const value = useMemo<UploadWidgetValue | null>(
    () => (photoUrl ? { url: photoUrl, publicId: photoPublicId ?? null } : null),
    [photoUrl, photoPublicId],
  );

  const save = async (next: UploadWidgetValue | null) => {
    if ((next?.url ?? null) === (photoUrl ?? null)) return;
    try {
      const result = await registryRequest<PatientPhotoResult>(`patients/${patientId}/photo`, {
        method: "POST",
        body: { photoUrl: next?.url ?? null, photoPublicId: next?.publicId ?? null },
      });
      onSaved(result.data);
      toast.success(next ? "Patient photo saved." : "Patient photo removed.");
    } catch (error) {
      toast.error(errorMessage(error, "The photo could not be saved."));
    }
  };

  return <UploadWidget value={value} onChange={(next) => void save(next)} folder="patients" />;
}
