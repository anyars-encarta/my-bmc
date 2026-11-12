import { ArrowLeftRight, CircleCheck, CircleX, Lock, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { PatientSearchPicker } from "@/components/clinical/PatientSearchPicker";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  bloodGroupOptions,
  duplicateReasonLabels,
  maritalStatusOptions,
  mergeFieldLabels,
  mergeModuleLabels,
  optionLabel,
  sexOptions,
} from "@/constants/patients";
import { useLoader } from "@/hooks/use-registry";
import { ageSexLabel, formatDate, formatDateTime, humanize } from "@/lib/patient-format";
import { RegistryError, errorMessage, registryRequest, withQuery } from "@/lib/patients-api";
import type {
  DuplicatePair,
  MergePreview,
  MergeResult,
  MergeSummary,
  MergeTask,
  MergeableField,
  PatientDetail,
  PatientSummary,
} from "@/types/patients";

import { Field } from "./form-parts";

type Pair = { survivorId: string; mergedId: string };

const MERGE_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: "In progress",
  DONE: "Complete",
  FAILED: "Needs retry",
  MANUAL_REVIEW: "Needs manual review",
  PENDING: "Pending",
};

const mergeStatusVariant = (status: string) =>
  status === "DONE" ? "default" : status === "FAILED" || status === "MANUAL_REVIEW" ? "destructive" : "secondary";

const fieldText = (patient: PatientDetail, field: MergeableField) => {
  const value = patient[field] ?? null;
  if (value === null || value === "") return "";
  if (field === "dateOfBirth") return `${formatDate(value)}${patient.dobEstimated ? " (approx.)" : ""}`;
  if (field === "maritalStatus") return optionLabel(maritalStatusOptions, value);
  if (field === "bloodGroup") return optionLabel(bloodGroupOptions, value);
  if (field === "photoUrl") return "Photo on file";
  return value;
};

/** Tests whether the source value is available for a merge choice, independent of display text. */
const hasMergeValue = (patient: PatientDetail, field: MergeableField) =>
  field === "photoUrl" ? Boolean(patient.photoUrl) : Boolean(fieldText(patient, field));

function PatientCell({ patient }: { patient: PatientSummary }) {
  if (patient.masked) {
    return (
      <Link to={`/patients/show/${patient.id}`} className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-2 hover:underline">
        <Lock className="size-4" aria-hidden="true" /> Restricted record
      </Link>
    );
  }
  return (
    <div>
      <Link to={`/patients/show/${patient.id}`} className="font-medium underline-offset-2 hover:underline">
        {patient.fullName}
      </Link>
      <p className="text-xs text-muted-foreground">
        {[patient.mrn, ageSexLabel(patient), patient.phone, `registered ${formatDate(patient.registeredAt)}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

function TaskList({ tasks }: { tasks: MergeTask[] }) {
  return (
    <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-2 rounded-md border p-2">
          {task.status === "DONE" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {mergeModuleLabels[task.module] ?? humanize(task.module)}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {MERGE_STATUS_LABELS[task.status] ?? task.status}
                {task.rowsMoved ? ` · ${task.rowsMoved} record${task.rowsMoved === 1 ? "" : "s"} moved` : ""}
              </span>
            </p>
            {task.note ? <p className="text-xs text-muted-foreground">{task.note}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Side-by-side compare and merge                                      */
/* ------------------------------------------------------------------ */

function MergeWorkspace({
  pair,
  onSwap,
  onClose,
  onMerged,
}: {
  pair: Pair;
  onSwap: () => void;
  onClose: () => void;
  onMerged: () => void;
}) {
  const { data: preview, loading, error } = useLoader(
    () =>
      registryRequest<MergePreview>(withQuery("patients/merge/preview", pair)).then((result) => result.data),
    [pair.survivorId, pair.mergedId],
  );
  const [picks, setPicks] = useState<Set<MergeableField>>(new Set());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);

  // Default to the duplicate's value wherever the surviving record has none.
  useEffect(() => {
    if (!preview) return;
    setPicks(
      new Set(
        preview.mergeableFields.filter(
          (field) => !hasMergeValue(preview.survivor, field) && hasMergeValue(preview.merged, field),
        ),
      ),
    );
  }, [preview]);

  const merge = async () => {
    setSaving(true);
    try {
      const response = await registryRequest<MergeResult>("patients/merge", {
        method: "POST",
        body: { ...pair, reason: reason.trim(), takeFromMerged: [...picks] },
      });
      setResult(response.data);
      toast.success("Records merged.");
      onMerged();
    } catch (caught) {
      toast.error(errorMessage(caught, "The records could not be merged."));
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Merge recorded
            <Badge variant={mergeStatusVariant(result.status)}>{MERGE_STATUS_LABELS[result.status] ?? result.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The duplicate now points to the surviving record. Each module moved its own records; anything
            that could not be moved is listed below and can be retried from the merge history.
          </p>
          <TaskList tasks={result.tasks} />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/patients/show/${result.survivorId}`}>Open the surviving record</Link>
            </Button>
            <Button variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const restricted = error instanceof RegistryError && error.code === "BREAK_GLASS_REQUIRED";
  const restrictedPatientId = restricted ? (error.details as { patientId?: string } | undefined)?.patientId : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Compare and merge</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onSwap} disabled={saving}>
            <ArrowLeftRight aria-hidden="true" /> Swap records
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !preview ? <p className="text-sm text-muted-foreground">Loading both records...</p> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{restricted ? "One of these records is restricted" : "The records could not be compared"}</AlertTitle>
            <AlertDescription>
              {restricted ? (
                <>
                  Open the restricted chart, break glass with your reason, then come back to merge.{" "}
                  {restrictedPatientId ? (
                    <Link to={`/patients/show/${restrictedPatientId}`} className="font-medium underline">
                      Open the restricted chart
                    </Link>
                  ) : null}
                </>
              ) : (
                error.message
              )}
            </AlertDescription>
          </Alert>
        ) : null}

        {preview ? (
          <>
            <p className="text-sm text-muted-foreground">
              The left record survives and keeps its MRN. Choose which value to keep where the two records
              differ. Allergies, conditions, contacts and identity documents from both records are combined.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Field</TableHead>
                    <TableHead>Keep this record</TableHead>
                    <TableHead>Duplicate (will be merged)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Name</TableCell>
                    <TableCell className="font-semibold">{preview.survivor.fullName}</TableCell>
                    <TableCell>{preview.merged.fullName}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">MRN</TableCell>
                    <TableCell className="font-mono font-semibold">{preview.survivor.mrn}</TableCell>
                    <TableCell className="font-mono">{preview.merged.mrn}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Sex</TableCell>
                    <TableCell>{optionLabel(sexOptions, preview.survivor.sex)}</TableCell>
                    <TableCell>{optionLabel(sexOptions, preview.merged.sex)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Registered</TableCell>
                    <TableCell>{formatDate(preview.survivor.registeredAt)}</TableCell>
                    <TableCell>{formatDate(preview.merged.registeredAt)}</TableCell>
                  </TableRow>
                  {preview.mergeableFields.map((field) => {
                    const left = fieldText(preview.survivor, field);
                    const right = fieldText(preview.merged, field);
                    const valuesDiffer =
                      field === "photoUrl"
                        ? preview.survivor.photoUrl !== preview.merged.photoUrl
                        : left !== right;
                    const selectable =
                      valuesDiffer && (field === "photoUrl" || hasMergeValue(preview.merged, field));
                    const choice = picks.has(field) ? "merged" : "survivor";
                    return (
                      <TableRow key={field}>
                        <TableCell className="font-medium">{mergeFieldLabels[field]}</TableCell>
                        {selectable ? (
                          <TableCell colSpan={2} className="p-0">
                            <RadioGroup
                              aria-label={`${mergeFieldLabels[field]} to keep`}
                              value={choice}
                              onValueChange={(value) =>
                                setPicks((current) => {
                                  const next = new Set(current);
                                  if (value === "merged") next.add(field);
                                  else next.delete(field);
                                  return next;
                                })
                              }
                              className="grid grid-cols-2 gap-0"
                            >
                              {(["survivor", "merged"] as const).map((side) => {
                                const source = side === "survivor" ? preview.survivor : preview.merged;
                                const sideLabel = side === "survivor" ? "Survivor" : "Merged";
                                return (
                                  <div key={side} className="flex min-w-0 items-center gap-2 p-2">
                                    <RadioGroupItem
                                      value={side}
                                      id={`merge-${field}-${side}`}
                                      aria-label={`${sideLabel} record ${field === "photoUrl" ? "photo" : mergeFieldLabels[field]}`}
                                    />
                                    <Label htmlFor={`merge-${field}-${side}`} className="min-w-0 font-normal">
                                      {field === "photoUrl" ? (
                                        source.photoUrl ? (
                                          <img
                                            src={source.photoUrl}
                                            alt={`${sideLabel} record photo`}
                                            className="size-16 rounded border object-cover"
                                          />
                                        ) : (
                                          <span>{sideLabel} record — no photo</span>
                                        )
                                      ) : (
                                        (side === "survivor" ? left : right) || "— (empty)"
                                      )}
                                    </Label>
                                  </div>
                                );
                              })}
                            </RadioGroup>
                          </TableCell>
                        ) : (
                          <>
                            <TableCell>{left || "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{right || "—"}</TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <section aria-label="Pre-checks" className="space-y-2">
              <h3 className="text-sm font-semibold">Pre-checks</h3>
              <ul className="space-y-1.5 text-sm">
                {preview.prechecks.map((check) => (
                  <li key={check.code} className="flex items-start gap-2">
                    {check.passed ? (
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
                    )}
                    <span className={check.passed ? "" : "font-medium text-destructive"}>
                      {check.message}
                      <span className="sr-only">{check.passed ? " (passed)" : " (failed)"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <Field label="Reason for merging" htmlFor="merge-reason" required hint="At least 10 characters. Merging cannot be undone from this screen.">
              <Textarea
                id="merge-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button
                variant="destructive"
                disabled={saving || !preview.canMerge || reason.trim().length < 10}
                onClick={() => void merge()}
              >
                {saving ? "Merging..." : "Merge records"}
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export const PatientDuplicatesPage = () => {
  const [tab, setTab] = useState("queue");
  const [pair, setPair] = useState<Pair | null>(null);
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState<PatientSummary | null>(null);
  const [duplicate, setDuplicate] = useState<PatientSummary | null>(null);

  const queue = useLoader(
    () => registryRequest<DuplicatePair[]>(withQuery("patients/duplicates", { page, limit: 20 })),
    [page],
  );
  const history = useLoader(
    () => registryRequest<MergeSummary[]>(withQuery("merge-tasks", { page: historyPage, limit: 25 })),
    [historyPage],
  );
  const pairs = queue.data?.data ?? [];
  const pagination = queue.data?.pagination;
  const merges = history.data?.data ?? [];
  const historyPagination = history.data?.pagination;

  const refresh = () => {
    queue.reload();
    history.reload();
  };

  const act = async (action: () => Promise<string>, failure: string) => {
    setBusy(true);
    try {
      toast.success(await action());
      refresh();
    } catch (error) {
      toast.error(errorMessage(error, failure));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (candidate: DuplicatePair) =>
    act(async () => {
      await registryRequest(`patients/duplicates/${candidate.id}/dismiss`, { method: "POST" });
      return "Marked as different patients.";
    }, "The pair could not be updated.");

  const sweep = () =>
    act(async () => {
      const result = await registryRequest<{ scanned: number; queued: number }>("patients/duplicates/sweep", {
        method: "POST",
        body: { sinceDays: 7 },
      });
      return `Checked ${result.data.scanned} recent record${result.data.scanned === 1 ? "" : "s"}; ${result.data.queued} new possible duplicate${result.data.queued === 1 ? "" : "s"} found.`;
    }, "The duplicate check could not be run.");

  const retry = (merge: MergeSummary) =>
    act(async () => {
      const result = await registryRequest<MergeSummary>(`merge-tasks/${merge.id}/retry`, { method: "POST" });
      return result.data.status === "DONE" ? "All records have been moved." : "Some records still could not be moved.";
    }, "The merge could not be retried.");

  const compare = (candidate: DuplicatePair) => {
    // Keep the older registration by default; the user can swap.
    const [first, second] =
      (candidate.patientA.registeredAt ?? "") <= (candidate.patientB.registeredAt ?? "")
        ? [candidate.patientA, candidate.patientB]
        : [candidate.patientB, candidate.patientA];
    setPair({ survivorId: first.id, mergedId: second.id });
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Duplicate patients" canCreate={false} />

      {pair ? (
        <MergeWorkspace
          key={`${pair.survivorId}-${pair.mergedId}`}
          pair={pair}
          onSwap={() => setPair({ survivorId: pair.mergedId, mergedId: pair.survivorId })}
          onClose={() => setPair(null)}
          onMerged={refresh}
        />
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="queue">Possible duplicates{pagination ? ` (${pagination.total})` : ""}</TabsTrigger>
          <TabsTrigger value="manual">Merge two records</TabsTrigger>
          <TabsTrigger value="history">Merge history</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Pairs waiting for review</CardTitle>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void sweep()}>
                <RotateCw aria-hidden="true" /> Check recent registrations
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {queue.error ? <p className="text-sm text-destructive" role="alert">{queue.error.message}</p> : null}
              {!queue.error && pairs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {queue.loading ? "Loading..." : "No possible duplicates are waiting for review."}
                </p>
              ) : null}
              {pairs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Record</TableHead>
                      <TableHead>Possible duplicate</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead>Found</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairs.map((candidate) => (
                      <TableRow key={candidate.id}>
                        <TableCell><PatientCell patient={candidate.patientA} /></TableCell>
                        <TableCell><PatientCell patient={candidate.patientB} /></TableCell>
                        <TableCell>
                          <Badge variant={candidate.score >= 0.85 ? "destructive" : "secondary"}>
                            {Math.round(candidate.score * 100)}%
                          </Badge>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {candidate.reasons.map((reason) => duplicateReasonLabels[reason] ?? reason).join(", ")}
                          </p>
                        </TableCell>
                        <TableCell>
                          {formatDate(candidate.detectedAt)}
                          <span className="block text-xs text-muted-foreground">
                            {candidate.source === "REGISTRATION" ? "At registration" : "By the nightly check"}
                          </span>
                        </TableCell>
                        <TableCell className="space-x-2 text-right">
                          <Button size="sm" disabled={busy} onClick={() => compare(candidate)}>
                            Compare
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => void dismiss(candidate)}>
                            Different patients
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
              {pagination && (pagination.totalPages > 1 || page > 1) ? (
                <div className="flex items-center justify-end gap-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={!pagination.hasMore} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Choose the two records</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
              <Field label="Record to keep">
                <PatientSearchPicker value={keep} onChange={setKeep} excludePatientId={duplicate?.id} />
              </Field>
              <Field label="Duplicate record">
                <PatientSearchPicker value={duplicate} onChange={setDuplicate} excludePatientId={keep?.id} />
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={!keep || !duplicate}
                  onClick={() => keep && duplicate && setPair({ survivorId: keep.id, mergedId: duplicate.id })}
                >
                  Compare
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent merges</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {history.error ? <p className="text-sm text-destructive" role="alert">{history.error.message}</p> : null}
              {!history.error && merges.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {history.loading ? "Loading..." : "No records have been merged yet."}
                </p>
              ) : null}
              {merges.map((merge) => (
                <details key={merge.id} className="rounded-md border p-3 text-sm">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">
                      {merge.merged ? `${merge.merged.name} (${merge.merged.mrn})` : "Duplicate"} →{" "}
                      {merge.survivor ? `${merge.survivor.name} (${merge.survivor.mrn})` : "Surviving record"}
                    </span>
                    <Badge variant={mergeStatusVariant(merge.status)}>
                      {MERGE_STATUS_LABELS[merge.status] ?? merge.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(merge.mergedAt)}
                      {merge.mergedByName ? ` · ${merge.mergedByName}` : ""}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p>
                      <span className="text-muted-foreground">Reason:</span> {merge.reason}
                    </p>
                    <TaskList tasks={merge.tasks} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/patients/show/${merge.survivorId}`}>Open the surviving record</Link>
                      </Button>
                      {merge.status !== "DONE" ? (
                        <Button size="sm" disabled={busy} onClick={() => void retry(merge)}>
                          <RotateCw aria-hidden="true" /> Retry moving records
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </details>
              ))}
              {historyPagination && historyPagination.totalPages > 1 ? (
                <div className="flex items-center justify-end gap-3 text-sm">
                  <span className="text-muted-foreground">
                    Page {historyPagination.page} of {historyPagination.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage(historyPage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!historyPagination.hasMore}
                    onClick={() => setHistoryPage(historyPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ListView>
  );
};
