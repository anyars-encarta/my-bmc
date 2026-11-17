import { AlertTriangle, ClipboardPlus, FileText, HeartPulse, Pill, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RegistryError, errorMessage, withQuery } from "@/lib/patients-api";
import { clinicalRequest } from "@/lib/clinical-api";
import { useDebouncedValue } from "@/hooks/use-registry";
import { useGetIdentity } from "@refinedev/core";

type VisitRow = {
  visit: { id: string; visitType: string; payerType: string; currentUnitId: string | null; openedAt: string; status: string };
  patientName: string;
  unitName: string | null;
};
type Unit = { id: string; code: string; name: string };
type EwsPolicy = { id: string; code: string; name: string; version: number; active: boolean; effectiveFrom: string };
type TriageRow = {
  id: string;
  assessedAt: string;
  triageCategory: string;
  chiefComplaint: string;
  isolationRequired: boolean;
  pregnant: boolean | null;
  mobility: string | null;
  notes: string | null;
  vitals: {
    recordedAt: string;
    temperatureC: string | null;
    pulseBpm: number | null;
    respRate: number | null;
    systolic: number | null;
    diastolic: number | null;
    spo2: number | null;
    weightKg: string | null;
    heightCm: string | null;
    painScore: number | null;
    bloodGlucoseMmol: string | null;
    gcs: number | null;
    avpu: string | null;
    muacCm: string | null;
    ewsScore: number | null;
    ewsBand: string | null;
  } | null;
};
const formatTriageObservations = (vitals: TriageRow["vitals"]): Array<[string, string | number]> => {
  if (!vitals) return [];
  return [
    ["Temperature", vitals.temperatureC == null ? null : `${vitals.temperatureC} °C`],
    ["Pulse", vitals.pulseBpm == null ? null : `${vitals.pulseBpm} /min`],
    ["Respiratory rate", vitals.respRate == null ? null : `${vitals.respRate} /min`],
    ["Blood pressure", vitals.systolic == null || vitals.diastolic == null ? null : `${vitals.systolic}/${vitals.diastolic} mmHg`],
    ["SpO₂", vitals.spo2 == null ? null : `${vitals.spo2}%`],
    ["Weight", vitals.weightKg == null ? null : `${vitals.weightKg} kg`],
    ["Height", vitals.heightCm == null ? null : `${vitals.heightCm} cm`],
    ["Pain score", vitals.painScore],
    ["Blood glucose", vitals.bloodGlucoseMmol == null ? null : `${vitals.bloodGlucoseMmol} mmol/L`],
    ["GCS", vitals.gcs],
    ["AVPU", vitals.avpu],
    ["MUAC", vitals.muacCm == null ? null : `${vitals.muacCm} cm`],
  ].filter((entry): entry is [string, string | number] => entry[1] !== null);
};
type EncounterRecord = {
  id: string;
  visitId: string;
  status: string;
  disposition: string | null;
  followUpDate: string | null;
  chiefComplaint: string | null;
  notes: Array<{ id: string; noteType: string; body: string; version: number; status: string; amendsId: string | null }>;
  diagnoses: Array<{ id: string; icd10Code: string; description: string; diagnosisType: string; certainty: string; status: string }>;
  vitals: Array<{ id: string; recordedAt: string; ewsScore: number | null; ewsBand: string | null; pulseBpm: number | null; temperatureC: string | null; spo2: number | null }>;
  orders: Array<{ id: string; orderType: string; status: string; priority: string; paymentRequired: boolean; paymentClearedAt: string | null }>;
  prescriptions: Array<{ id: string; rxNo: string; status: string; validUntil: string | null; items: Array<{ id: string; drugId: string; dose: string; doseUnit: string; frequencyCode: string; route: string; quantityPrescribed: string }> }>;
};
type SearchOption = { id: string; label: string; description?: string };
type SafetyAlert = { code: string; message: string };
type SafetyOverride = { code: string; reason: string };
type SafetyRequest = (overrides: SafetyOverride[]) => Promise<void>;
type TaskRow = {
  task: { id: string; description: string; status: string; priority: string; createdAt: string };
  patientName: string;
  mrn: string;
  unitName: string;
};
type PreparedImport = {
  type: "drug" | "icd10";
  rows: Array<Record<string, unknown>>;
  validated: boolean;
};

const EMPTY_VITALS = {
  temperatureC: "", pulseBpm: "", respRate: "", systolic: "", diastolic: "",
  spo2: "", weightKg: "", heightCm: "", painScore: "", bloodGlucoseMmol: "",
  gcs: "", avpu: "", muacCm: "",
};
const encounterTypes = ["CONSULTATION", "REVIEW", "ED_CONSULT", "PROCEDURE", "ANTENATAL", "NURSING"];
const triageCategories = ["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"];
const medicationFrequencies = ["OD", "BD", "TDS", "QID", "Q4H", "Q6H", "Q8H", "Q12H", "NOCTE", "STAT", "PRN", "WEEKLY"];
const dispositions = ["DISCHARGED_HOME", "ADMITTED", "REFERRED_OUT", "OBSERVATION", "FOLLOW_UP", "LAMA", "DIED", "LEFT_WITHOUT_BEING_SEEN"];
const nullableNumber = (value: string) => value.trim() ? Number(value) : null;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] ?? char));

const printDocument = (title: string, lines: Array<[string, string | null | undefined]>) => {
  const child = window.open("", "_blank");
  if (!child) {
    toast.error("Allow pop-ups to print this clinical document.");
    return;
  }
  child.opener = null;
  const rows = lines.filter(([, value]) => value).map(([label, value]) =>
    `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value ?? "")}</p>`).join("");
  child.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>body{font:16px sans-serif;max-width:760px;margin:40px auto;padding:24px}h1{border-bottom:2px solid #222;padding-bottom:12px}p{margin:14px 0}@media print{button{display:none}}</style></head><body><h1>${escapeHtml(title)}</h1>${rows}<button onclick="window.print()">Print</button></body></html>`);
  child.document.close();
};

function AsyncClinicalPicker({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  search,
  disabled,
}: {
  value: SearchOption | null;
  onChange: (choice: SearchOption | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  search: (term: string) => Promise<SearchOption[]>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [options, setOptions] = useState<SearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const query = useDebouncedValue(term.trim(), 250);
  useEffect(() => {
    if (!open || query.length < 2) {
      setOptions([]);
      return;
    }
    let active = true;
    setLoading(true);
    search(query).then((rows) => { if (active) setOptions(rows); }).catch((error: unknown) => {
      if (active) toast.error(errorMessage(error, "Search failed."));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, query, search]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-start font-normal">
          <span className="truncate">{value?.label ?? placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={term} onValueChange={setTerm} placeholder={searchPlaceholder} />
          <CommandList>
            {query.length < 2 ? <CommandEmpty>Type at least two characters.</CommandEmpty> : null}
            {loading ? <CommandEmpty>Searching…</CommandEmpty> : null}
            {!loading && query.length >= 2 && options.length === 0 ? <CommandEmpty>No matches found.</CommandEmpty> : null}
            {options.map((option) => (
              <CommandItem key={option.id} value={option.id} onSelect={() => {
                onChange(option);
                setTerm("");
                setOpen(false);
              }}>
                <span>{option.label}{option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SafetyOverrideDialog({
  alerts,
  onCancel,
  onConfirm,
}: {
  alerts: SafetyAlert[];
  onCancel: () => void;
  onConfirm: (overrides: SafetyOverride[]) => void;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const complete = alerts.length > 0 && alerts.every((alert) => (reasons[alert.code] ?? "").trim().length >= 3);
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="safety-dialog-title">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle id="safety-dialog-title" className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" /> Clinical safety hard stop
          </CardTitle>
          <p className="text-sm text-muted-foreground">Review each alert. An override is recorded in the patient audit trail.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {alerts.map((alert) => (
            <div key={alert.code} className="space-y-2 rounded-md border border-destructive/40 p-3">
              <p className="text-sm font-medium">{alert.message}</p>
              <Label htmlFor={`override-${alert.code}`}>Reason to override</Label>
              <Textarea id={`override-${alert.code}`} value={reasons[alert.code] ?? ""} onChange={(event) =>
                setReasons((current) => ({ ...current, [alert.code]: event.target.value }))} rows={2} />
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={!complete} onClick={() =>
              onConfirm(alerts.map((alert) => ({ code: alert.code, reason: reasons[alert.code]!.trim() })))}>
              Record override and continue
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell.trim()); cell = ""; }
    else if (char === "\n") { row.push(cell.trim()); rows.push(row); row = []; cell = ""; }
    else if (char !== "\r") cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  const headers = rows.shift()?.map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, "_")) ?? [];
  return rows.filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export function ClinicalPage() {
  const { data: identity } = useGetIdentity<{ roles?: string[] }>();
  const isAdmin = (identity?.roles ?? []).some((role) => role === "super_admin" || role === "hospital_admin");
  const [tab, setTab] = useState<"triage" | "workbench" | "formulary" | "policies">("triage");
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [policies, setPolicies] = useState<EwsPolicy[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [triageHistory, setTriageHistory] = useState<TriageRow[]>([]);
  const [triageLoading, setTriageLoading] = useState(false);
  const [visitId, setVisitId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [encounterData, setEncounterData] = useState<EncounterRecord | null>(null);
  const [triage, setTriage] = useState({
    category: "GREEN",
    complaint: "",
    isolationRequired: false,
    pregnant: "unknown",
    mobility: "INDEPENDENT",
    notes: "",
  });
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const [soap, setSoap] = useState("");
  const [encounterType, setEncounterType] = useState("CONSULTATION");
  const [diagnosisChoice, setDiagnosisChoice] = useState<SearchOption | null>(null);
  const [diagnosisType, setDiagnosisType] = useState("PRIMARY");
  const [orderType, setOrderType] = useState("LAB");
  const [orderPriority, setOrderPriority] = useState("ROUTINE");
  const [serviceChoice, setServiceChoice] = useState<SearchOption | null>(null);
  const [orderNotes, setOrderNotes] = useState("");
  const [drugChoice, setDrugChoice] = useState<SearchOption | null>(null);
  const [rx, setRx] = useState({ dose: "", doseUnit: "mg", frequencyCode: "BD", route: "ORAL", durationDays: "5", quantity: "10", validUntil: "", instructions: "" });
  const [disposition, setDisposition] = useState("DISCHARGED_HOME");
  const [followUpDate, setFollowUpDate] = useState("");
  const [requestedUnitId, setRequestedUnitId] = useState("");
  const [clinicalSummary, setClinicalSummary] = useState("");
  const [referral, setReferral] = useState({ facilityName: "", specialty: "", urgency: "ROUTINE", reason: "" });
  const [certificate, setCertificate] = useState({ certType: "ATTENDANCE", fromDate: new Date().toISOString().slice(0, 10), toDate: "", remarks: "" });
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyAlert[]>([]);
  const [safetyRequest, setSafetyRequest] = useState<SafetyRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [policyForm, setPolicyForm] = useState({ code: "", name: "", version: "1", effectiveFrom: new Date().toISOString().slice(0, 10), rules: "" });
  const [drugSource, setDrugSource] = useState("EML");
  const [preparedImport, setPreparedImport] = useState<PreparedImport | null>(null);
  const [interactions, setInteractions] = useState({ genericA: "", genericB: "", severity: "MODERATE", effect: "", management: "", source: "" });

  const selectedVisit = useMemo(() => visits.find((row) => row.visit.id === visitId) ?? null, [visits, visitId]);
  const visitOptions = useMemo<SearchableSelectOption[]>(() => visits.map((row) => ({
    value: row.visit.id,
    label: `${row.patientName} · ${row.unitName ?? "Clinic"} · ${row.visit.visitType}`,
    keywords: row.unitName ?? "",
  })), [visits]);
  const unitOptions = useMemo<SearchableSelectOption[]>(() => units.map((unit) => ({
    value: unit.id, label: `${unit.name} · ${unit.code}`,
  })), [units]);

  const loadBase = useCallback(async () => {
    try {
      const [visitResult, refs, taskResult] = await Promise.all([
        clinicalRequest<VisitRow[]>("visits?status=OPEN"),
        clinicalRequest<{ units: Unit[]; ewsPolicies: EwsPolicy[] }>("clinical/references"),
        clinicalRequest<TaskRow[]>("outpatient-tasks?status=OPEN"),
      ]);
      const rows = visitResult.data;
      setVisits(rows);
      setUnits(refs.data.units);
      setPolicies(refs.data.ewsPolicies);
      setTasks(taskResult.data);
      setVisitId((current) => rows.some((row) => row.visit.id === current) ? current : rows[0]?.visit.id ?? "");
    } catch (error) {
      toast.error(errorMessage(error, "Clinical worklists could not be loaded."));
    }
  }, []);

  const loadEncounter = useCallback(async (id: string) => {
    if (!id) {
      setEncounterId("");
      setEncounterData(null);
      return;
    }
    try {
      const result = await clinicalRequest<EncounterRecord>(`encounters/${id}`);
      setEncounterId(id);
      setEncounterData(result.data);
    } catch (error) { toast.error(errorMessage(error, "Encounter could not be loaded.")); }
  }, []);

  const loadTriage = useCallback(async (id: string) => {
    if (!id) {
      setTriageHistory([]);
      setTriageLoading(false);
      return;
    }
    setTriageLoading(true);
    try {
      const result = await clinicalRequest<TriageRow[]>(`visits/${id}/triage`);
      if (id === visitId) setTriageHistory(result.data);
    } catch (error) {
      if (id === visitId) toast.error(errorMessage(error, "Triage history could not be loaded."));
    } finally {
      if (id === visitId) setTriageLoading(false);
    }
  }, [visitId]);

  useEffect(() => { void loadBase(); }, [loadBase]);
  useEffect(() => { void loadTriage(visitId); }, [loadTriage, visitId]);
  useEffect(() => {
    if (!visitId) {
      setEncounterId("");
      setEncounterData(null);
      return;
    }
    let active = true;
    clinicalRequest<Array<{ id: string; status: string }>>(`visits/${visitId}/encounters`)
      .then(({ data }) => {
        if (!active) return;
        const current = data.find((row) => row.status === "OPEN") ?? data[0];
        if (current) void loadEncounter(current.id);
        else { setEncounterId(""); setEncounterData(null); }
      })
      .catch((error: unknown) => { if (active) toast.error(errorMessage(error, "Visit encounters could not be loaded.")); });
    return () => { active = false; };
  }, [visitId, loadEncounter]);

  const findIcdCodes = useCallback(async (term: string): Promise<SearchOption[]> => {
    const result = await clinicalRequest<Array<{ code: string; title: string; chapter: string | null }>>(
      withQuery("icd10", { q: term, limit: 20 }),
    );
    return result.data.map((row) => ({ id: row.code, label: `${row.code} · ${row.title}`, description: row.chapter ?? undefined }));
  }, []);
  const findDrugs = useCallback(async (term: string): Promise<SearchOption[]> => {
    const result = await clinicalRequest<Array<{ id: string; genericName: string; brandName: string | null; strengthText: string | null; form: string }>>(
      withQuery("drugs", { q: term, limit: 20 }),
    );
    return result.data.map((row) => ({
      id: row.id,
      label: `${row.genericName}${row.strengthText ? ` · ${row.strengthText}` : ""}`,
      description: [row.brandName, row.form].filter(Boolean).join(" · "),
    }));
  }, []);
  const findServices = useCallback(async (term: string): Promise<SearchOption[]> => {
    const result = await clinicalRequest<Array<{ id: string; code: string; name: string; category: string }>>(
      withQuery("service-items", { q: term, limit: 30 }),
    );
    return result.data.map((row) => ({
      id: row.id,
      label: `${row.name} · ${row.code}`,
      description: row.category.replaceAll("_", " "),
    }));
  }, []);

  const runWithSafety = async (operation: SafetyRequest) => {
    try {
      await operation([]);
    } catch (error) {
      if (error instanceof RegistryError && error.code === "ORDER_SAFETY_HARD_STOP") {
        const details = error.details as { requiredOverrides?: SafetyAlert[] } | null;
        const alerts = details?.requiredOverrides ?? [];
        if (alerts.length) {
          setSafetyAlerts(alerts);
          setSafetyRequest(() => operation);
          return;
        }
      }
      throw error;
    }
  };
  const withBusy = async (operation: () => Promise<void>, success?: string, rethrow = false) => {
    setBusy(true);
    try {
      await operation();
      if (success) toast.success(success);
      await loadBase();
      if (encounterId) await loadEncounter(encounterId);
    } catch (error) {
      if (rethrow) throw error;
      const fieldErrors = error instanceof RegistryError
        ? Object.entries(error.fieldErrors).flatMap(([field, messages]) =>
          messages.map((message) => `${field}: ${message}`))
        : [];
      const message = errorMessage(error, "The clinical action could not be completed.");
      toast.error(fieldErrors.length ? `${message} ${fieldErrors.join("; ")}` : message);
    }
    finally { setBusy(false); }
  };
  const buildVitals = () => Object.fromEntries(Object.entries(vitals).map(([key, value]) =>
    [key, key === "avpu" ? value || null : nullableNumber(value)]));

  const startEncounter = () => withBusy(async () => {
    if (!visitId) return;
    const result = await clinicalRequest<{ id: string }>(`visits/${visitId}/encounters`, {
      method: "POST",
      body: { encounterType, chiefComplaint: triage.complaint || null },
    });
    await loadEncounter(result.data.id);
    setTab("workbench");
  }, "Encounter opened.");

  const saveTriage = () => withBusy(async () => {
    if (!visitId) return;
    const result = await clinicalRequest<{ ews: { score: number; band: string }; taskId: string | null }>(`visits/${visitId}/triage`, {
      method: "POST",
      body: {
        triageCategory: triage.category,
        chiefComplaint: triage.complaint,
        isolationRequired: triage.isolationRequired,
        pregnant: triage.pregnant === "unknown" ? null : triage.pregnant === "yes",
        mobility: triage.mobility,
        notes: triage.notes || null,
        vitals: buildVitals(),
      },
    });
    toast[result.data.ews.band === "HIGH" ? "error" : "success"](
      `Vitals recorded · EWS ${result.data.ews.score} (${result.data.ews.band})${result.data.taskId ? " · nurse task raised" : ""}`,
    );
    setVitals(EMPTY_VITALS);
    await loadTriage(visitId);
  });

  const createSoapNote = () => withBusy(async () => {
    if (!encounterId) return;
    await clinicalRequest(`encounters/${encounterId}/notes`, { method: "POST", body: { noteType: "SOAP", body: soap } });
    setSoap("");
  }, "SOAP note saved as a draft.");
  const addDiagnosis = () => withBusy(async () => {
    if (!encounterId || !diagnosisChoice) return;
    await clinicalRequest(`encounters/${encounterId}/diagnoses`, {
      method: "POST",
      body: { icd10Code: diagnosisChoice.id, diagnosisType, certainty: "PROVISIONAL", isNewCase: true },
    });
    setDiagnosisChoice(null);
  }, "Diagnosis added.");
  const saveEncounterVitals = () => withBusy(async () => {
    if (!encounterId) return;
    const result = await clinicalRequest<{ ews: { score: number; band: string }; taskId: string | null }>(`encounters/${encounterId}/vitals`, {
      method: "POST", body: buildVitals(),
    });
    toast[result.data.ews.band === "HIGH" ? "error" : "success"](
      `Vitals recorded · EWS ${result.data.ews.score} (${result.data.ews.band})${result.data.taskId ? " · nurse task raised" : ""}`,
    );
    setVitals(EMPTY_VITALS);
  });
  const createOrder = (overrides: SafetyOverride[]) => withBusy(async () => {
    if (!encounterId) return;
    await clinicalRequest(`encounters/${encounterId}/orders`, {
      method: "POST",
      body: {
        orderType,
        priority: orderPriority,
        serviceItemId: serviceChoice?.id ?? null,
        clinicalIndication: orderNotes || null,
        notes: orderNotes || null,
        overrides,
      },
    });
    setOrderNotes("");
    setServiceChoice(null);
  }, "Clinical order placed.", true);
  const createPrescription = (overrides: SafetyOverride[]) => withBusy(async () => {
    if (!encounterId || !drugChoice) return;
    await clinicalRequest(`encounters/${encounterId}/prescriptions`, {
      method: "POST",
      body: {
        items: [{
          drugId: drugChoice.id,
          dose: Number(rx.dose),
          doseUnit: rx.doseUnit,
          frequencyCode: rx.frequencyCode,
          route: rx.route,
          durationDays: Number(rx.durationDays),
          quantityPrescribed: Number(rx.quantity),
          instructions: rx.instructions || null,
          isPrn: rx.frequencyCode === "PRN",
          prnReason: rx.frequencyCode === "PRN" ? rx.instructions : null,
        }],
        validUntil: rx.validUntil,
        overrides,
      },
    });
    setDrugChoice(null);
  }, "Prescription saved as a draft.", true);
  const issuePrescription = (id: string) => withBusy(async () => {
    await clinicalRequest(`prescriptions/${id}/issue`, { method: "POST", body: {} });
  }, "Prescription issued.");
  const signEncounter = () => withBusy(async () => {
    if (!encounterId) return;
    await clinicalRequest(`encounters/${encounterId}/sign`, { method: "POST", body: {} });
  }, "Encounter signed.");

  const createReferral = async () => {
    if (!encounterId) return null;
    const result = await clinicalRequest<{ id: string; facilityName: string | null; specialty: string | null; reason: string; urgency: string }>(
      `encounters/${encounterId}/referrals`, { method: "POST", body: referral },
    );
    printDocument("Referral", [
      ["Patient", selectedVisit?.patientName],
      ["Receiving facility", result.data.facilityName],
      ["Specialty", result.data.specialty],
      ["Urgency", result.data.urgency],
      ["Reason", result.data.reason],
    ]);
    return result.data.id;
  };
  const saveDisposition = () => withBusy(async () => {
    if (!encounterId) return;
    let referralId: string | null = null;
    if (disposition === "REFERRED_OUT") referralId = await createReferral();
    await clinicalRequest(`encounters/${encounterId}/disposition`, {
      method: "POST",
      body: {
        disposition,
        followUpDate: disposition === "FOLLOW_UP" ? followUpDate : null,
        requestedUnitId: disposition === "ADMITTED" ? requestedUnitId || null : null,
        clinicalSummary: clinicalSummary || null,
        referralId,
      },
    });
  }, "Disposition saved.");
  const issueCertificate = () => withBusy(async () => {
    if (!encounterId) return;
    const result = await clinicalRequest<{ certificateNo: string; verificationCode: string; certType: string; fromDate: string; toDate: string | null; remarks: string | null }>(
      `encounters/${encounterId}/medical-certificates`, { method: "POST", body: certificate },
    );
    printDocument("Medical certificate", [
      ["Patient", selectedVisit?.patientName],
      ["Certificate type", result.data.certType.replaceAll("_", " ")],
      ["From", result.data.fromDate],
      ["To", result.data.toDate],
      ["Remarks", result.data.remarks],
      ["Certificate number", result.data.certificateNo],
      ["Verification code", result.data.verificationCode],
    ]);
  }, "Medical certificate issued.");

  const updateTask = (id: string, action: "acknowledge" | "resolve") => withBusy(async () => {
    await clinicalRequest(`outpatient-tasks/${id}/${action}`, { method: "POST", body: {} });
  }, action === "acknowledge" ? "Nursing task acknowledged." : "Nursing task resolved.");

  const savePolicy = () => withBusy(async () => {
    let rules: unknown;
    try {
      rules = JSON.parse(policyForm.rules) as unknown;
    } catch {
      throw new Error("Policy rules must be valid JSON.");
    }
    await clinicalRequest("ews-policies", {
      method: "POST",
      body: { ...policyForm, version: Number(policyForm.version), effectiveTo: null, active: true, rules },
    });
    setPolicyForm({ ...policyForm, code: "", name: "", rules: "" });
  }, "EWS policy version added.");
  const setPolicyActive = (policy: EwsPolicy) => withBusy(async () => {
    await clinicalRequest(`ews-policies/${policy.id}`, { method: "PATCH", body: { active: !policy.active } });
  }, policy.active ? "EWS policy deactivated." : "EWS policy activated.");
  const prepareImport = async (type: "drug" | "icd10", file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
    if (type === "drug") {
      const rows = parsed.map((row) => ({
        genericName: row.generic_name ?? row.generic ?? "",
        brandName: row.brand_name || null,
        form: (row.form || "OTHER").toUpperCase(),
        strengthText: row.strength_text || row.strength || null,
        strengthUnit: row.strength_unit || null,
        defaultRoute: row.route || row.default_route || null,
      }));
        setPreparedImport({ type, rows, validated: false });
    } else {
      const rows = parsed.map((row) => ({
        code: row.code ?? "",
        title: row.title ?? row.description ?? "",
        chapter: row.chapter || null,
        block: row.block || null,
        isNotifiable: ["true", "1", "yes"].includes((row.is_notifiable ?? "").toLowerCase()),
        sexRestriction: row.sex_restriction ? row.sex_restriction.toUpperCase() : null,
      }));
        setPreparedImport({ type, rows, validated: false });
    }
    } catch (error) {
      toast.error(errorMessage(error, "The selected file could not be read."));
    }
  };
  const runImport = async (dryRun: boolean) => {
    if (!preparedImport) return;
    setBusy(true);
    try {
      if (preparedImport.type === "drug") {
        const result = await clinicalRequest<{ validRows: number; imported: number; duplicatesSkipped: number }>("drugs/import", {
          method: "POST",
          body: { source: drugSource, dryRun, rows: preparedImport.rows },
        });
        if (dryRun) {
          setPreparedImport({ ...preparedImport, validated: true });
          toast.success(`${result.data.validRows} medicine rows validated; ${result.data.duplicatesSkipped} duplicates skipped.`);
        } else {
          toast.success(`${result.data.imported} medicines imported; ${result.data.duplicatesSkipped} duplicates skipped.`);
          setPreparedImport(null);
        }
      } else {
        const result = await clinicalRequest<{ validRows: number; imported: number; existingRows: number; duplicatesSkipped: number }>("icd10/import", {
          method: "POST", body: { dryRun, rows: preparedImport.rows },
        });
        if (dryRun) {
          setPreparedImport({ ...preparedImport, validated: true });
          toast.success(`${result.data.validRows} ICD-10 rows validated; ${result.data.existingRows} existing codes will be updated; ${result.data.duplicatesSkipped} duplicates skipped.`);
        } else {
          toast.success(`${result.data.imported} ICD-10 rows imported; ${result.data.duplicatesSkipped} duplicates skipped.`);
          setPreparedImport(null);
        }
      }
    } catch (error) {
      toast.error(errorMessage(error, "The reference import failed."));
    } finally { setBusy(false); }
  };
  const saveInteraction = () => withBusy(async () => {
    await clinicalRequest("drug-interactions", { method: "POST", body: interactions });
    setInteractions({ genericA: "", genericB: "", severity: "MODERATE", effect: "", management: "", source: "" });
  }, "Drug interaction saved.");

  const activeTab = (name: typeof tab, label: string, Icon: typeof HeartPulse) => (
    <Button type="button" variant={tab === name ? "default" : "outline"} onClick={() => setTab(name)}>
      <Icon className="mr-2 size-4" />{label}
    </Button>
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">OPD encounters & prescribing</h1>
          <p className="text-sm text-muted-foreground">Triage, document, order, prescribe and disposition an outpatient visit.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void loadBase()}><RefreshCw className="mr-2 size-4" />Refresh worklists</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {activeTab("triage", "Triage", HeartPulse)}
        {activeTab("workbench", "Doctor workbench", ClipboardPlus)}
        {activeTab("formulary", "Clinical references", Pill)}
        {isAdmin ? activeTab("policies", "EWS policies", ShieldCheck) : null}
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(240px,1fr)_auto] md:items-end">
          <div className="space-y-2">
            <Label>Open visit</Label>
            <SearchableSelect options={visitOptions} value={visitId} onValueChange={setVisitId}
              placeholder="Select a patient visit" searchPlaceholder="Search patient or clinic" />
          </div>
          <div className="text-sm text-muted-foreground">
            {selectedVisit ? <span><strong className="text-foreground">{selectedVisit.patientName}</strong> · {selectedVisit.unitName ?? "Clinic"} · {selectedVisit.visit.visitType}</span> : "No open visits in this worklist."}
          </div>
        </CardContent>
      </Card>

      {tab === "triage" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,.7fr)]">
          <Card>
            <CardHeader><CardTitle>Triage assessment & vitals</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label>Triage category</Label>
                  <Select value={triage.category} onValueChange={(category) => setTriage({ ...triage, category })}>
                    <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{triageCategories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Mobility</Label>
                  <Select value={triage.mobility} onValueChange={(mobility) => setTriage({ ...triage, mobility })}>
                    <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["INDEPENDENT", "ASSISTED", "WHEELCHAIR", "STRETCHER"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2"><Label>Chief complaint</Label>
                  <Textarea value={triage.complaint} onChange={(event) => setTriage({ ...triage, complaint: event.target.value })} maxLength={300} rows={2} />
                </div>
                <div className="space-y-2"><Label>Pregnancy</Label>
                  <Select value={triage.pregnant} onValueChange={(pregnant) => setTriage({ ...triage, pregnant })}>
                    <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                      <SelectItem value="unknown">Not recorded</SelectItem><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 pt-8 text-sm"><input type="checkbox" checked={triage.isolationRequired} onChange={(event) => setTriage({ ...triage, isolationRequired: event.target.checked })} />Isolation required</label>
              </div>
              <div>
                <h3 className="mb-3 font-medium">Observations</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["temperatureC", "Temperature °C"], ["pulseBpm", "Pulse / min"], ["respRate", "Respiratory rate"],
                    ["systolic", "Systolic BP"], ["diastolic", "Diastolic BP"], ["spo2", "SpO₂ %"],
                    ["weightKg", "Weight kg"], ["heightCm", "Height cm"], ["painScore", "Pain score"],
                    ["bloodGlucoseMmol", "Blood glucose mmol/L"], ["gcs", "GCS"], ["muacCm", "MUAC cm"],
                  ] as const).map(([key, label]) => (
                    <div className="space-y-1" key={key}><Label htmlFor={`triage-${key}`}>{label}</Label>
                      <Input id={`triage-${key}`} type="number" step="any" value={vitals[key]} onChange={(event) => setVitals({ ...vitals, [key]: event.target.value })} />
                    </div>
                  ))}
                  <div className="space-y-1"><Label>AVPU</Label>
                    <Select value={vitals.avpu || "none"} onValueChange={(value) => setVitals({ ...vitals, avpu: value === "none" ? "" : value })}>
                      <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger><SelectContent>
                        <SelectItem value="none">Not recorded</SelectItem>{["A", "V", "P", "U"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="space-y-2"><Label>Triage notes</Label><Textarea value={triage.notes} onChange={(event) => setTriage({ ...triage, notes: event.target.value })} rows={2} /></div>
              <Button disabled={busy || !visitId || !triage.complaint.trim()} onClick={() => void saveTriage()}>Save triage & calculate EWS</Button>
              {policies.length === 0 ? <p className="text-sm text-destructive">No EWS policy is configured. An administrator must load a clinically approved policy before saving vitals.</p> : null}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-5" />High early-warning tasks</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {tasks.length === 0 ? <p className="text-sm text-muted-foreground">No open tasks.</p> : tasks.map((row) => (
                  <div key={row.task.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{row.patientName}</strong><Badge variant="destructive">{row.task.priority}</Badge>
                    </div>
                    <p className="text-sm">{row.task.description}</p><p className="text-xs text-muted-foreground">{row.unitName} · {new Date(row.task.createdAt).toLocaleString()}</p>
                    <div className="flex gap-2">
                      {row.task.status === "OPEN" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateTask(row.task.id, "acknowledge")}>Acknowledge</Button> : null}
                      <Button size="sm" disabled={busy} onClick={() => void updateTask(row.task.id, "resolve")}>Resolve</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent triage assessments & vitals</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {triageLoading ? <p className="text-sm text-muted-foreground">Loading triage history…</p> : null}
                {!triageLoading && triageHistory.length === 0 ? <p className="text-sm text-muted-foreground">No triage assessments recorded for this visit.</p> : null}
                {triageHistory.map((row) => {
                  const observations = formatTriageObservations(row.vitals);
                  return (
                    <div key={row.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{new Date(row.assessedAt).toLocaleString()}</strong>
                        <div className="flex gap-2">
                          <Badge variant="secondary">{row.triageCategory}</Badge>
                          {row.vitals?.ewsBand ? <Badge variant={row.vitals.ewsBand === "HIGH" ? "destructive" : "outline"}>EWS {row.vitals.ewsScore} · {row.vitals.ewsBand}</Badge> : null}
                        </div>
                      </div>
                      <p className="text-sm">{row.chiefComplaint}</p>
                      <div className="grid gap-1 text-sm sm:grid-cols-2">
                        {observations.map(([label, value]) => (
                          <p key={label}><span className="text-muted-foreground">{label}:</span> {value}</p>
                        ))}
                      </div>
                      {row.notes ? <p className="text-sm text-muted-foreground">{row.notes}</p> : null}
                      <p className="text-xs text-muted-foreground">
                        {row.mobility ? `Mobility: ${row.mobility.replaceAll("_", " ")}` : ""}
                        {row.pregnant === null ? "" : `${row.mobility ? " · " : ""}Pregnancy: ${row.pregnant ? "Yes" : "No"}`}
                        {row.isolationRequired ? " · Isolation required" : ""}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "workbench" ? (
        !encounterData ? (
          <Card><CardHeader><CardTitle>Start a consultation</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="max-w-sm space-y-2"><Label>Encounter type</Label>
              <Select value={encounterType} onValueChange={setEncounterType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{encounterTypes.map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
            </div>
            <Button disabled={busy || !visitId} onClick={() => void startEncounter()}>Open encounter</Button>
          </CardContent></Card>
        ) : (
          <div className="space-y-6">
            <Card><CardHeader><CardTitle className="flex flex-wrap items-center justify-between gap-2">
              <span>{selectedVisit?.patientName} · {encounterData.status}</span>
              <div className="flex gap-2"><Badge variant={encounterData.status === "SIGNED" ? "default" : "secondary"}>{encounterData.status}</Badge>
                {encounterData.status === "OPEN" ? <Button size="sm" disabled={busy} onClick={() => void signEncounter()}>Sign encounter</Button> : null}
              </div>
            </CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
              {encounterData.chiefComplaint || selectedVisit?.unitName || "Outpatient encounter"} · {selectedVisit?.visit.visitType} · {selectedVisit?.visit.payerType}
            </CardContent></Card>

            {encounterData.status === "OPEN" ? <div className="grid gap-6 xl:grid-cols-2">
              <Card><CardHeader><CardTitle>SOAP note</CardTitle></CardHeader><CardContent className="space-y-4">
                <Textarea aria-label="SOAP note" value={soap} onChange={(event) => setSoap(event.target.value)} rows={8} placeholder={"Subjective\n\nObjective\n\nAssessment\n\nPlan"} />
                <Button disabled={busy || !soap.trim()} onClick={() => void createSoapNote()}>Save draft note</Button>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Diagnosis · ICD-11</CardTitle></CardHeader><CardContent className="space-y-4">
                <AsyncClinicalPicker value={diagnosisChoice} onChange={setDiagnosisChoice} placeholder="Search diagnosis" searchPlaceholder="Search code or diagnosis" search={findIcdCodes} />
                <div className="flex gap-3"><Select value={diagnosisType} onValueChange={setDiagnosisType}><SelectTrigger className="max-w-48"><SelectValue /></SelectTrigger><SelectContent>{["PRIMARY", "SECONDARY", "DIFFERENTIAL"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                  <Button disabled={busy || !diagnosisChoice} onClick={() => void addDiagnosis()}>Add diagnosis</Button>
                </div>
                <ul className="space-y-1 text-sm">{encounterData.diagnoses.filter((row) => row.status === "ACTIVE").map((row) =>
                  <li key={row.id}><Badge variant="outline">{row.diagnosisType}</Badge> {row.icd10Code} · {row.description}</li>)}</ul>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Vitals</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="space-y-2 border-b pb-4">
                  <h3 className="font-medium">Vitals recorded during triage</h3>
                  {triageLoading ? <p className="text-sm text-muted-foreground">Loading triage vitals…</p> : null}
                  {!triageLoading && triageHistory.length === 0 ? <p className="text-sm text-muted-foreground">No triage vitals recorded for this visit.</p> : null}
                  {triageHistory.slice(0, 3).map((row) => (
                    <div key={row.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span>{new Date(row.assessedAt).toLocaleString()}</span>
                        <div className="flex gap-2">
                          <Badge variant="secondary">{row.triageCategory}</Badge>
                          {row.vitals?.ewsBand ? <Badge variant={row.vitals.ewsBand === "HIGH" ? "destructive" : "outline"}>EWS {row.vitals.ewsScore} · {row.vitals.ewsBand}</Badge> : null}
                        </div>
                      </div>
                      <div className="grid gap-1 text-sm sm:grid-cols-2">
                        {formatTriageObservations(row.vitals).map(([label, value]) => (
                          <p key={label}><span className="text-muted-foreground">{label}:</span> {value}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {([
                    ["temperatureC", "Temperature °C"], ["pulseBpm", "Pulse / min"], ["respRate", "Respiratory rate"],
                    ["systolic", "Systolic BP"], ["diastolic", "Diastolic BP"], ["spo2", "SpO₂ %"],
                    ["weightKg", "Weight kg"], ["heightCm", "Height cm"], ["painScore", "Pain score"],
                    ["bloodGlucoseMmol", "Blood glucose mmol/L"], ["gcs", "GCS"], ["muacCm", "MUAC cm"],
                  ] as const).map(([key, label]) => <div className="space-y-1" key={key}><Label>{label}</Label>
                    <Input type="number" step="any" value={vitals[key]} onChange={(event) => setVitals({ ...vitals, [key]: event.target.value })} /></div>)}
                </div>
                <Button variant="outline" disabled={busy} onClick={() => void saveEncounterVitals()}>Record vitals & calculate EWS</Button>
                <div className="space-y-2">{encounterData.vitals.map((row) => <p key={row.id} className="text-sm">
                  {new Date(row.recordedAt).toLocaleString()} · EWS {row.ewsScore ?? "—"} <Badge variant={row.ewsBand === "HIGH" ? "destructive" : "secondary"}>{row.ewsBand ?? "—"}</Badge>
                  {row.pulseBpm ? ` · Pulse ${row.pulseBpm}` : ""}{row.temperatureC ? ` · Temp ${row.temperatureC}°C` : ""}{row.spo2 ? ` · SpO₂ ${row.spo2}%` : ""}
                </p>)}</div>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Orders</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Order type</Label><Select value={orderType} onValueChange={setOrderType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["LAB", "IMAGING", "PROCEDURE", "NURSING", "CONSULT_REQUEST", "DIET"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label>Priority</Label><Select value={orderPriority} onValueChange={setOrderPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["ROUTINE", "URGENT", "STAT"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
                </div>
                <AsyncClinicalPicker value={serviceChoice} onChange={setServiceChoice} placeholder="Search service or test (optional)" searchPlaceholder="Search service catalogue" search={findServices} />
                <Textarea value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} rows={2} placeholder="Clinical indication / notes" />
                <Button disabled={busy} onClick={() => void runWithSafety(createOrder).catch((error: unknown) => toast.error(errorMessage(error, "Order could not be placed.")))}>Place order</Button>
                <ul className="space-y-1 text-sm">{encounterData.orders.map((order) => <li key={order.id}>
                  {order.orderType} · {order.priority} · {order.status}
                  {order.paymentRequired && !order.paymentClearedAt ? <Badge variant="destructive" className="ml-2">Awaiting payment</Badge> : null}
                </li>)}</ul>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Prescription</CardTitle></CardHeader><CardContent className="space-y-4">
                <AsyncClinicalPicker value={drugChoice} onChange={setDrugChoice} placeholder="Search formulary" searchPlaceholder="Search generic, brand or strength" search={findDrugs} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label>Dose</Label><Input type="number" step="any" value={rx.dose} onChange={(event) => setRx({ ...rx, dose: event.target.value })} /></div>
                  <div className="space-y-1"><Label>Dose unit</Label><Input value={rx.doseUnit} onChange={(event) => setRx({ ...rx, doseUnit: event.target.value })} /></div>
                  <div className="space-y-1"><Label>Frequency</Label><Select value={rx.frequencyCode} onValueChange={(frequencyCode) => setRx({ ...rx, frequencyCode })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{medicationFrequencies.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label>Route</Label><Input value={rx.route} onChange={(event) => setRx({ ...rx, route: event.target.value })} /></div>
                  <div className="space-y-1"><Label>Duration (days)</Label><Input type="number" min="1" value={rx.durationDays} onChange={(event) => setRx({ ...rx, durationDays: event.target.value })} /></div>
                  <div className="space-y-1"><Label>Quantity</Label><Input type="number" min="0.001" step="any" value={rx.quantity} onChange={(event) => setRx({ ...rx, quantity: event.target.value })} /></div>
                  <div className="space-y-1"><Label>Prescription expiry</Label><Input type="date" value={rx.validUntil} onChange={(event) => setRx({ ...rx, validUntil: event.target.value })} /></div>
                </div>
                <Input aria-label="Prescription instructions" value={rx.instructions} onChange={(event) => setRx({ ...rx, instructions: event.target.value })} placeholder="Patient instructions / PRN reason" />
                <Button disabled={busy || !drugChoice || !rx.dose || !rx.quantity || !rx.validUntil} onClick={() => void runWithSafety(createPrescription).catch((error: unknown) => toast.error(errorMessage(error, "Prescription could not be saved.")))}>Create prescription draft</Button>
                <div className="space-y-2">{encounterData.prescriptions.map((record) => <div key={record.id} className="rounded border p-3 text-sm">
                  <div className="flex justify-between gap-2"><strong>{record.status}</strong><span>{record.validUntil ?? "No expiry date"}</span></div>
                  <p>{record.items.length} medication item(s)</p>
                  {record.status === "DRAFT" ? <Button size="sm" disabled={busy} onClick={() => void issuePrescription(record.id)}>Issue prescription</Button> : null}
                </div>)}</div>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Disposition & follow-up</CardTitle></CardHeader><CardContent className="space-y-4">
                <div className="space-y-2"><Label>Disposition</Label><Select value={disposition} onValueChange={setDisposition}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dispositions.map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></div>
                {disposition === "FOLLOW_UP" ? <div className="space-y-2"><Label>Follow-up date</Label><Input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} /></div> : null}
                {disposition === "ADMITTED" ? <><div className="space-y-2"><Label>Requested ward</Label><SearchableSelect options={unitOptions} value={requestedUnitId} onValueChange={setRequestedUnitId} placeholder="Select a unit" searchPlaceholder="Search clinical units" /></div><Textarea value={clinicalSummary} onChange={(event) => setClinicalSummary(event.target.value)} placeholder="Admission clinical summary" /></> : null}
                {disposition === "REFERRED_OUT" ? <div className="space-y-3 rounded border p-3">
                  <p className="font-medium">Outgoing referral (required)</p><Input value={referral.facilityName} onChange={(event) => setReferral({ ...referral, facilityName: event.target.value })} placeholder="Receiving facility" />
                  <Input value={referral.specialty} onChange={(event) => setReferral({ ...referral, specialty: event.target.value })} placeholder="Specialty" />
                  <Select value={referral.urgency} onValueChange={(urgency) => setReferral({ ...referral, urgency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["ROUTINE", "URGENT", "EMERGENCY"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
                  <Textarea value={referral.reason} onChange={(event) => setReferral({ ...referral, reason: event.target.value })} placeholder="Referral reason" />
                </div> : null}
                <Button disabled={busy || (disposition === "FOLLOW_UP" && !followUpDate) || (disposition === "ADMITTED" && !requestedUnitId) || (disposition === "REFERRED_OUT" && !referral.reason.trim())} onClick={() => void saveDisposition()}>Save disposition</Button>
              </CardContent></Card>

              <Card><CardHeader><CardTitle>Medical certificate</CardTitle></CardHeader><CardContent className="space-y-4">
                <Select value={certificate.certType} onValueChange={(certType) => setCertificate({ ...certificate, certType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["SICK_LEAVE", "FITNESS", "ATTENDANCE", "MATERNITY"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select>
                <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>From</Label><Input type="date" value={certificate.fromDate} onChange={(event) => setCertificate({ ...certificate, fromDate: event.target.value })} /></div><div className="space-y-1"><Label>To</Label><Input type="date" value={certificate.toDate} onChange={(event) => setCertificate({ ...certificate, toDate: event.target.value })} /></div></div>
                <Textarea value={certificate.remarks} onChange={(event) => setCertificate({ ...certificate, remarks: event.target.value })} placeholder="Certificate remarks" />
                <Button variant="outline" disabled={busy} onClick={() => void issueCertificate()}><Printer className="mr-2 size-4" />Issue & print</Button>
              </CardContent></Card>
            </div> : null}

            <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-5" />Signed notes & history</CardTitle></CardHeader>
              <CardContent className="space-y-3">{encounterData.notes.map((note) => <div key={note.id} className="rounded border p-3">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{note.noteType}</Badge><Badge variant={note.status === "SIGNED" ? "default" : "secondary"}>{note.status}</Badge><span className="text-xs text-muted-foreground">Version {note.version}</span>{note.amendsId ? <span className="text-xs">Amendment</span> : null}</div>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{note.body}</pre>
              </div>)}</CardContent>
            </Card>
          </div>
        )
      ) : null}

      {tab === "formulary" ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card><CardHeader><CardTitle>Import formulary (EML / NHIS)</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="space-y-2"><Label>List source</Label><Select value={drugSource} onValueChange={setDrugSource}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EML">Essential medicines list</SelectItem><SelectItem value="NHIS">NHIS medicines list</SelectItem></SelectContent></Select></div>
            <p className="text-sm text-muted-foreground">CSV headers: generic_name, form (required), brand_name, strength_text, strength_unit, route. Existing entries are retained; duplicate rows in the file are skipped.</p>
            <Input type="file" accept=".csv,text/csv" onChange={(event) => void prepareImport("drug", event.target.files?.[0])} disabled={busy} />
            {preparedImport?.type === "drug" ? <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void runImport(true)}>Validate {preparedImport.rows.length} rows</Button><Button disabled={busy || !preparedImport.validated} onClick={() => void runImport(false)}>Import validated list</Button></div> : null}
            <p className="text-xs text-muted-foreground">Import marks each entry against the selected list. Review source licensing and clinical governance before import.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Drug interaction reference</CardTitle></CardHeader><CardContent className="space-y-4">
            <Input value={interactions.genericA} onChange={(event) => setInteractions({ ...interactions, genericA: event.target.value })} placeholder="First generic name (alphabetical)" />
            <Input value={interactions.genericB} onChange={(event) => setInteractions({ ...interactions, genericB: event.target.value })} placeholder="Second generic name" />
            <Select value={interactions.severity} onValueChange={(severity) => setInteractions({ ...interactions, severity })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["MINOR", "MODERATE", "MAJOR", "CONTRAINDICATED"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
            <Input value={interactions.effect} onChange={(event) => setInteractions({ ...interactions, effect: event.target.value })} placeholder="Clinical effect" />
            <Input value={interactions.management} onChange={(event) => setInteractions({ ...interactions, management: event.target.value })} placeholder="Management guidance" />
            <Input value={interactions.source} onChange={(event) => setInteractions({ ...interactions, source: event.target.value })} placeholder="Evidence source" />
            <Button disabled={busy || !interactions.genericA.trim() || !interactions.genericB.trim()} onClick={() => void saveInteraction()}>Add interaction</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Import ICD-10 reference</CardTitle></CardHeader><CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">CSV headers: code, title, chapter, block, is_notifiable, sex_restriction. Import only an authorized ICD-10 dataset.</p>
            <Input type="file" accept=".csv,text/csv" onChange={(event) => void prepareImport("icd10", event.target.files?.[0])} disabled={busy} />
            {preparedImport?.type === "icd10" ? <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => void runImport(true)}>Validate {preparedImport.rows.length} rows</Button><Button disabled={busy || !preparedImport.validated} onClick={() => void runImport(false)}>Import validated codes</Button></div> : null}
          </CardContent></Card>
          <InteractionsList />
        </div>
      ) : null}

      {tab === "policies" && isAdmin ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card><CardHeader><CardTitle>Versioned EWS policy configuration</CardTitle></CardHeader><CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Clinical governance must approve the scoring chart before activation. Configure ranges as JSON; no default clinical thresholds are assumed.</p>
            <p className="text-sm text-muted-foreground">Rules must use <code>parameters</code> (a map of observed field names to arrays of scoring rules) and <code>bands</code> with integer <code>mediumMin</code> and <code>highMin</code> values. Each scoring rule needs integer <code>points</code> and either a numeric <code>min</code>/<code>max</code> range or a categorical <code>value</code>. Use the exact observation keys: temperatureC, pulseBpm, respRate, systolic, diastolic, spo2, weightKg, heightCm, painScore, bloodGlucoseMmol, gcs, avpu, muacCm. Enter only ranges approved by clinical governance; highMin must exceed mediumMin.</p>
            <Input value={policyForm.code} onChange={(event) => setPolicyForm({ ...policyForm, code: event.target.value })} placeholder="Policy code" />
            <Input value={policyForm.name} onChange={(event) => setPolicyForm({ ...policyForm, name: event.target.value })} placeholder="Policy name" />
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>Version</Label><Input type="number" min="1" value={policyForm.version} onChange={(event) => setPolicyForm({ ...policyForm, version: event.target.value })} /></div><div className="space-y-1"><Label>Effective from</Label><Input type="date" value={policyForm.effectiveFrom} onChange={(event) => setPolicyForm({ ...policyForm, effectiveFrom: event.target.value })} /></div></div>
            <Textarea value={policyForm.rules} onChange={(event) => setPolicyForm({ ...policyForm, rules: event.target.value })} rows={10} placeholder={'{"parameters":{},"bands":{"mediumMin":0,"highMin":1}}'} />
            <Button disabled={busy || !policyForm.code || !policyForm.name || !policyForm.rules} onClick={() => void savePolicy()}>Save approved policy version</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Configured versions</CardTitle></CardHeader><CardContent className="space-y-3">
            {policies.map((policy) => <div key={policy.id} className="flex items-center justify-between gap-3 rounded border p-3">
              <div><p className="font-medium">{policy.name} · v{policy.version}</p><p className="text-sm text-muted-foreground">{policy.code} · Effective {policy.effectiveFrom}</p></div>
              <div className="flex items-center gap-2"><Badge variant={policy.active ? "default" : "secondary"}>{policy.active ? "Active" : "Inactive"}</Badge>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void setPolicyActive(policy)}>{policy.active ? "Deactivate" : "Activate"}</Button></div>
            </div>)}
            {policies.length === 0 ? <p className="text-sm text-muted-foreground">No configured EWS policy.</p> : null}
          </CardContent></Card>
        </div>
      ) : null}

      {safetyRequest ? <SafetyOverrideDialog alerts={safetyAlerts} onCancel={() => { setSafetyRequest(null); setSafetyAlerts([]); }}
        onConfirm={(overrides) => {
          const action = safetyRequest;
          setSafetyRequest(null);
          setSafetyAlerts([]);
          setBusy(true);
          void action(overrides).then(async () => {
            toast.success("Clinical action recorded with audited safety override.");
            await loadBase();
            if (encounterId) await loadEncounter(encounterId);
          }).catch((error: unknown) => toast.error(errorMessage(error, "The overridden action could not be completed.")))
            .finally(() => setBusy(false));
        }} /> : null}
    </div>
  );
}

function InteractionsList() {
  const [rows, setRows] = useState<Array<{ id: string; genericA: string; genericB: string; severity: string; effect: string | null }>>([]);
  useEffect(() => {
    clinicalRequest<typeof rows>("drug-interactions?limit=100").then(({ data }) => setRows(data))
      .catch((error: unknown) => toast.error(errorMessage(error, "Interactions could not be loaded.")));
  }, []);
  return (
    <Card><CardHeader><CardTitle>Known interactions</CardTitle></CardHeader><CardContent className="space-y-2">
      {rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
        <span>{row.genericA} + {row.genericB}{row.effect ? ` · ${row.effect}` : ""}</span><Badge variant={row.severity === "MAJOR" || row.severity === "CONTRAINDICATED" ? "destructive" : "secondary"}>{row.severity}</Badge>
      </div>)}
      {!rows.length ? <p className="text-sm text-muted-foreground">No interactions have been configured.</p> : null}
    </CardContent></Card>
  );
}
