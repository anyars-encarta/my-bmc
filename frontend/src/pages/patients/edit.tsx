import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { CreateView, CreateViewHeader } from "@/components/refine-ui/views/create-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { confidentialityOptions, patientStatusOptions } from "@/constants/patients";
import { usePatientReferences } from "@/hooks/use-registry";
import { RegistryError, errorMessage, registryRequest } from "@/lib/patients-api";
import type { PatientChart } from "@/types/patients";

import {
  demographicsFromPatient,
  emptyDemographics,
  toDemographicsPayload,
  type DemographicsForm,
  type FieldErrors,
} from "./form-model";
import { DemographicsFields, Field, OptionSelect } from "./form-parts";

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** Scopes edit-form state to the patient ID in the current route. */
export const PatientEdit = () => {
  const { id = "" } = useParams();
  return <PatientEditForm key={id} id={id} />;
};

/** Loads and saves demographics for one patient record. */
const PatientEditForm = ({ id }: { id: string }) => {
  const navigate = useNavigate();
  const references = usePatientReferences();
  const [patient, setPatient] = useState<PatientChart | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<DemographicsForm>(emptyDemographics);
  const [status, setStatus] = useState("ACTIVE");
  const [deceasedAt, setDeceasedAt] = useState("");
  const [confidentiality, setConfidentiality] = useState("NORMAL");
  const [unit, setUnit] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    registryRequest<PatientChart>(`patients/${id}`)
      .then((result) => {
        if (!active) return;
        const data = result.data;
        if (data.status === "MERGED" || data.redacted.length > 0) {
          setLoadError("This record cannot be edited.");
          return;
        }
        setPatient(data);
        setForm(demographicsFromPatient(data));
        setStatus(data.status);
        setDeceasedAt(toLocalInput(data.deceasedAt));
        setConfidentiality(data.confidentiality);
        setUnit(data.registeredUnitId ?? "");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof RegistryError && error.code === "BREAK_GLASS_REQUIRED") {
          navigate(`/patients/show/${id}`, { replace: true });
          return;
        }
        setLoadError(errorMessage(error, "The patient could not be loaded."));
      });
    return () => {
      active = false;
    };
  }, [id, navigate]);

  const unitOptions = useMemo(
    () => [
      { value: "", label: "Not specified" },
      ...(references?.units ?? []).map((entry) => ({ value: entry.id, label: entry.name, keywords: entry.code })),
    ],
    [references],
  );

  const save = async () => {
    if (!patient) return;
    const before = toDemographicsPayload(demographicsFromPatient(patient));
    const after = toDemographicsPayload(form);
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(after) as Array<keyof typeof after>) {
      if (after[key] !== before[key]) changes[key] = after[key];
    }
    if (status !== patient.status) changes.status = status;
    if (status === "DECEASED" && deceasedAt && deceasedAt !== toLocalInput(patient.deceasedAt)) {
      changes.deceasedAt = new Date(deceasedAt).toISOString();
    }
    if (confidentiality !== patient.confidentiality) changes.confidentiality = confidentiality;
    if ((unit || null) !== (patient.registeredUnitId ?? null)) changes.registeredUnitId = unit || null;

    if (Object.keys(changes).length === 0) {
      navigate(`/patients/show/${patient.id}`);
      return;
    }

    setSaving(true);
    setErrors({});
    setProblem("");
    try {
      await registryRequest(`patients/${patient.id}`, {
        method: "PATCH",
        body: { ...changes, version: patient.version },
      });
      toast.success("Patient details updated.");
      navigate(`/patients/show/${patient.id}`);
    } catch (error) {
      setErrors(error instanceof RegistryError ? error.fieldErrors : {});
      setProblem(errorMessage(error, "The changes could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <CreateView>
        <CreateViewHeader title="Edit patient" />
        <Alert variant="destructive">
          <AlertTitle>Cannot edit this patient</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <Button variant="outline" className="w-fit" asChild>
          <Link to={`/patients/show/${id}`}>Back to the chart</Link>
        </Button>
      </CreateView>
    );
  }

  if (!patient) {
    return (
      <CreateView>
        <CreateViewHeader title="Edit patient" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </CreateView>
    );
  }

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Edit patient" />
      <Card>
        <CardHeader>
          <CardTitle>
            {patient.fullName} · <span className="font-mono">{patient.mrn}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {problem ? (
            <Alert variant="destructive">
              <AlertTitle>The changes were not saved</AlertTitle>
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
          {patient.isUnidentified ? (
            <Alert>
              <AlertTitle>Unidentified patient</AlertTitle>
              <AlertDescription>
                The placeholder name can only be replaced by identifying the patient from the chart.
              </AlertDescription>
            </Alert>
          ) : null}

          <DemographicsFields
            form={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            errors={errors}
            today={references?.today}
            nameLocked={patient.isUnidentified}
          />

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold">Record settings</legend>
            <Field label="Status" htmlFor="patient-status" error={errors.status}>
              <OptionSelect id="patient-status" value={status} onChange={setStatus} options={patientStatusOptions} />
            </Field>
            {status === "DECEASED" ? (
              <Field
                label="Date and time of death"
                htmlFor="patient-deceased-at"
                hint="Leave empty to use the current time"
                error={errors.deceasedAt}
              >
                <Input
                  id="patient-deceased-at"
                  type="datetime-local"
                  value={deceasedAt}
                  onChange={(event) => setDeceasedAt(event.target.value)}
                />
              </Field>
            ) : null}
            <Field
              label="Confidentiality"
              htmlFor="patient-confidentiality"
              hint="Restricted and VIP records can only be opened with a recorded reason."
            >
              <OptionSelect
                id="patient-confidentiality"
                value={confidentiality}
                onChange={setConfidentiality}
                options={confidentialityOptions}
              />
            </Field>
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
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button variant="outline" asChild>
              <Link to={`/patients/show/${patient.id}`}>Cancel</Link>
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </CreateView>
  );
};
