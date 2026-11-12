import { Lock, Search, UserRoundPlus, UserRoundX } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PATIENT_REGISTER_ROLES, patientStatusOptions, sexOptions } from "@/constants/patients";
import { useDebouncedValue, usePatientReferences, useRegistryAccess } from "@/hooks/use-registry";
import { ageSexLabel, formatDate, humanize } from "@/lib/patient-format";
import { errorMessage, registryRequest, withQuery } from "@/lib/patients-api";
import { cn } from "@/lib/utils";
import type { PatientDetail, PatientSummary, RegistryPagination } from "@/types/patients";

import { Field, OptionSelect } from "./form-parts";

const PAGE_SIZE = 25;

type SearchState = {
  rows: PatientSummary[];
  pagination: RegistryPagination | null;
  mergedFromMrn: string | null;
};

export const PatientList = () => {
  const navigate = useNavigate();
  const { can } = useRegistryAccess();
  const canRegister = can(PATIENT_REGISTER_ROLES);
  const searchRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState("");
  const query = useDebouncedValue(term.trim(), 300);
  const [status, setStatus] = useState("");
  const [sex, setSex] = useState("");
  const [unidentifiedOnly, setUnidentifiedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<SearchState>({ rows: [], pagination: null, mergedFromMrn: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [unknownOpen, setUnknownOpen] = useState(false);

  useEffect(() => setPage(1), [query, status, sex, unidentifiedOnly]);

  useEffect(() => {
    if (query.length === 1) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    registryRequest<PatientSummary[], { mergedFromMrn: string | null }>(
      withQuery("patients", {
        q: query,
        page,
        limit: PAGE_SIZE,
        status,
        sex,
        isUnidentified: unidentifiedOnly ? "true" : "",
      }),
      { signal: controller.signal },
    )
      .then((result) => {
        setState({
          rows: result.data,
          pagination: result.pagination ?? null,
          mergedFromMrn: result.meta?.mergedFromMrn ?? null,
        });
        setActiveIndex(result.data.length > 0 && query ? 0 : -1);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setState({ rows: [], pagination: null, mergedFromMrn: null });
        setError(errorMessage(caught, "Patients could not be loaded."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, status, sex, unidentifiedOnly]);

  // "/" jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const open = (patient: PatientSummary) => navigate(`/patients/show/${patient.id}`);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(state.rows.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      const selected = state.rows[activeIndex];
      if (selected) open(selected);
    } else if (event.key === "Escape") {
      setTerm("");
    }
  };

  const pagination = state.pagination;

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Patients" canCreate={false} />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="patient-search">Find a patient</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="patient-search"
                  ref={searchRef}
                  autoFocus
                  autoComplete="off"
                  className="pl-9"
                  value={term}
                  placeholder="Name, MRN, phone or document number"
                  aria-describedby="patient-search-hint"
                  aria-controls="patient-results"
                  onChange={(event) => setTerm(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                />
              </div>
            </div>
            {canRegister ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => navigate("/patients/register")}>
                  <UserRoundPlus aria-hidden="true" /> Register patient
                </Button>
                <Button variant="outline" onClick={() => setUnknownOpen(true)}>
                  <UserRoundX aria-hidden="true" /> Unidentified patient
                </Button>
              </div>
            ) : null}
          </div>
          <p id="patient-search-hint" className="text-xs text-muted-foreground">
            Press / to search, ↑ ↓ to move through the results and Enter to open a chart.
            {query.length === 1 ? " Type at least 2 characters." : ""}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Status" htmlFor="patient-status-filter">
              <OptionSelect
                id="patient-status-filter"
                value={status}
                onChange={setStatus}
                options={patientStatusOptions}
                emptyLabel="All records"
              />
            </Field>
            <Field label="Sex" htmlFor="patient-sex-filter">
              <OptionSelect id="patient-sex-filter" value={sex} onChange={setSex} options={sexOptions} emptyLabel="Any" />
            </Field>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                id="patient-unidentified-filter"
                checked={unidentifiedOnly}
                onCheckedChange={(checked) => setUnidentifiedOnly(checked === true)}
              />
              <Label htmlFor="patient-unidentified-filter" className="font-normal">
                Unidentified patients only
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {state.mergedFromMrn ? (
        <Alert>
          <AlertTitle>Record merged</AlertTitle>
          <AlertDescription>
            {state.mergedFromMrn} was merged into the record below. Use the surviving record.
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Search failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-5">
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {loading
              ? "Searching..."
              : pagination
                ? `${pagination.total.toLocaleString()} ${query ? "matching" : "registered"} patient${pagination.total === 1 ? "" : "s"}${query ? "" : ", most recent first"}`
                : ""}
          </p>
          {!loading && state.rows.length === 0 && !error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {query ? "No patients match this search." : "No patients have been registered yet."}
            </p>
          ) : (
            <Table id="patient-results">
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>MRN</TableHead>
                  <TableHead>Age / sex</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.rows.map((patient, index) => (
                  <TableRow
                    key={patient.id}
                    tabIndex={0}
                    aria-selected={index === activeIndex}
                    className={cn("cursor-pointer", index === activeIndex && "bg-muted")}
                    onClick={() => open(patient)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") open(patient);
                    }}
                  >
                    {patient.masked ? (
                      <>
                        <TableCell className="font-medium text-muted-foreground">
                          <span className="inline-flex items-center gap-2">
                            <Lock className="size-4" aria-hidden="true" /> Restricted record
                          </span>
                        </TableCell>
                        <TableCell colSpan={4} className="text-muted-foreground">
                          Open the chart and give a reason to view this record.
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell>
                          <span className="font-medium">{patient.fullName}</span>
                          {patient.isUnidentified ? <Badge variant="secondary" className="ml-2">Unidentified</Badge> : null}
                          {patient.confidentiality !== "NORMAL" ? (
                            <Badge variant="destructive" className="ml-2">
                              <Lock aria-hidden="true" /> {patient.confidentiality === "VIP" ? "VIP" : "Restricted"}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono">{patient.mrn}</TableCell>
                        <TableCell>{ageSexLabel(patient)}</TableCell>
                        <TableCell>{patient.phone ?? "—"}</TableCell>
                        <TableCell>{formatDate(patient.registeredAt)}</TableCell>
                      </>
                    )}
                    <TableCell>
                      <Badge variant={patient.status === "ACTIVE" ? "outline" : "secondary"}>
                        {humanize(patient.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {pagination && pagination.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-end gap-3 text-sm">
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
        </CardContent>
      </Card>

      <UnidentifiedPatientDialog open={unknownOpen} onOpenChange={setUnknownOpen} />
    </ListView>
  );
};

/** Emergency registration of an unknown patient: sex and an estimated age are enough. */
function UnidentifiedPatientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const references = usePatientReferences();
  const [sex, setSex] = useState("UNKNOWN");
  const [age, setAge] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const ageValue = Number(age);
  const ageValid = age.trim() !== "" && Number.isInteger(ageValue) && ageValue >= 0 && ageValue <= 130;

  const submit = async () => {
    if (!ageValid) return;
    setSaving(true);
    try {
      const result = await registryRequest<PatientDetail>("patients", {
        method: "POST",
        body: { unidentified: true, sex, estimatedAgeYears: ageValue, registeredUnitId: unit || null },
      });
      toast.success(`Registered as ${result.data.fullName} (${result.data.mrn}).`);
      onOpenChange(false);
      navigate(`/patients/show/${result.data.id}`);
    } catch (error) {
      toast.error(errorMessage(error, "The patient could not be registered."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register an unidentified patient</DialogTitle>
          <DialogDescription>
            For emergencies when the patient cannot be identified. A placeholder name and an MRN are
            issued now; identify the patient from the chart later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Sex" htmlFor="unknown-sex" required>
            <OptionSelect id="unknown-sex" value={sex} onChange={setSex} options={sexOptions} />
          </Field>
          <Field label="Estimated age (years)" htmlFor="unknown-age" required>
            <Input
              id="unknown-age"
              type="number"
              min={0}
              max={130}
              step={1}
              value={age}
              autoFocus
              onChange={(event) => setAge(event.target.value)}
            />
          </Field>
          <Field label="Receiving unit" className="sm:col-span-2">
            <SearchableSelect
              value={unit}
              onValueChange={setUnit}
              options={[
                { value: "", label: "Not specified" },
                ...(references?.units ?? []).map((entry) => ({ value: entry.id, label: entry.name, keywords: entry.code })),
              ]}
              placeholder="Select a unit"
              searchPlaceholder="Search units and wards..."
              emptyMessage="No matching unit."
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={saving || !ageValid}>
            {saving ? "Registering..." : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
