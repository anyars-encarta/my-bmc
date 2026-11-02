import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNotification } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import { fetchFacilityLocalDate } from "@/lib/facility-clock";
import type { OrgUnitRecord, StaffRecord } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";

type BatchMove = { staffId: string; toUnitId: string };
type BatchRecord = {
  id: string;
  title: string;
  effectiveFrom: string;
  status: "DRAFT" | "APPROVED" | "APPLIED" | "CANCELLED";
  items: Array<{
    staffId: string;
    toUnitId: string;
    staffName: string;
    staffLastName: string;
    employeeId: string;
    toUnitName: string;
    toUnitCode: string;
  }>;
};
type BatchPreview = {
  moves: Array<{ staffName: string; employeeId: string; fromUnit: string; toUnit: string }>;
  coverage: Array<{
    unitName: string;
    shiftName: string;
    roleName: string;
    minimum: number;
    currentStaff: number;
    projectedStaff: number;
    currentShortfall: number;
    projectedShortfall: number;
    impact: "IMPROVED" | "REDUCED" | "UNCHANGED";
  }>;
};
type UnitEnvelope = { data?: OrgUnitRecord[]; message?: string; error?: string };
type StaffEnvelope = { data?: StaffRecord[]; pagination?: { hasMore?: boolean }; message?: string; error?: string };
type BatchEnvelope = { data?: BatchRecord; message?: string; error?: string };
type BatchesEnvelope = { data?: BatchRecord[]; message?: string; error?: string };

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const errorMessage = (payload: { message?: string; error?: string }, fallback: string) =>
  payload.message || payload.error || fallback;

export const TransfersPage = () => {
  const { open: notify } = useNotification();
  const [staffRecords, setStaffRecords] = useState<StaffRecord[]>([]);
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [title, setTitle] = useState("");
  const [facilityDate, setFacilityDate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [moves, setMoves] = useState<BatchMove[]>([{ staffId: "", toUnitId: "" }]);
  const [editingBatchId, setEditingBatchId] = useState("");
  const [activeBatchId, setActiveBatchId] = useState("");
  const [previewedBatchId, setPreviewedBatchId] = useState("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [saving, setSaving] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as T & { message?: string; error?: string };
    if (!response.ok) throw new Error(errorMessage(payload, "The request failed."));
    return payload;
  }, []);

  const loadBatches = useCallback(async () => {
    const payload = await request<BatchesEnvelope>("transfer-batches");
    setBatches(payload.data ?? []);
  }, [request]);

  useEffect(() => {
    const loadReferences = async () => {
      try {
        const [allUnits, staffRecords, facilityDate] = await Promise.all([
          fetchAllOrgUnits(),
          fetchAllStaff(),
          fetchFacilityLocalDate(),
        ]);
        setUnits(allUnits.filter((unit) => unit.active));
        setStaffRecords(staffRecords.filter((person) => person.status === "active"));
        setFacilityDate(facilityDate);
        setEffectiveFrom(facilityDate);
      } catch (error) {
        notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load transfer data." });
      }
    };
    loadReferences();
    loadBatches().catch((error) =>
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load batches." }),
    );
  }, [loadBatches, notify]);

  const createDraft = async () => {
    const validMoves = moves.filter((move) => move.staffId && move.toUnitId);
    if (!title.trim() || validMoves.length === 0 || validMoves.length !== moves.length) {
      notify?.({ type: "error", message: "Add a title and complete every staff-to-unit move." });
      return;
    }
    if (new Set(validMoves.map((move) => move.staffId)).size !== validMoves.length) {
      notify?.({ type: "error", message: "Each staff member can only be listed once." });
      return;
    }
    try {
      setSaving(true);
      const updatingDraft = Boolean(editingBatchId);
      const payload = await request<BatchEnvelope>(
        editingBatchId ? `transfer-batches/${editingBatchId}` : "transfer-batches",
        {
          method: editingBatchId ? "PATCH" : "POST",
          body: JSON.stringify({ title: title.trim(), effectiveFrom, items: validMoves }),
        },
      );
      const batch = payload.data;
      if (!batch) throw new Error("The draft was not returned by the server.");
      setActiveBatchId(batch.id);
      setPreviewedBatchId("");
      setEditingBatchId("");
      setPreview(null);
      setTitle("");
      setMoves([{ staffId: "", toUnitId: "" }]);
      await loadBatches();
      notify?.({ type: "success", message: updatingDraft ? "Transfer draft updated." : "Transfer draft created." });
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to create draft." });
    } finally {
      setSaving(false);
    }
  };

  const loadPreview = async (batchId = activeBatchId) => {
    if (!batchId) return;
    try {
      setSaving(true);
      const payload = await request<{ data?: BatchPreview }>(`transfer-batches/${batchId}/preview`);
      setPreview(payload.data ?? null);
      setActiveBatchId(batchId);
      setPreviewedBatchId(batchId);
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to preview coverage." });
    } finally {
      setSaving(false);
    }
  };

  const selectedBatch = batches.find((batch) => batch.id === activeBatchId);
  const editDraft = (batch: BatchRecord) => {
    setActiveBatchId(batch.id);
    setEditingBatchId(batch.id);
    setPreviewedBatchId("");
    setTitle(batch.title);
    setEffectiveFrom(batch.effectiveFrom);
    setMoves(batch.items.map((item) => ({ staffId: item.staffId, toUnitId: item.toUnitId })));
    setPreview(null);
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Transfers &amp; batch reshuffles" />
      <Card>
        <CardHeader><CardTitle>Create a reshuffle draft</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Draft title">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Ward cover rotation" />
            </Field>
            <Field label="Effective from">
              <Input type="date" min={facilityDate} value={effectiveFrom} disabled={!facilityDate} onChange={(event) => setEffectiveFrom(event.target.value)} />
            </Field>
          </div>
          <div className="space-y-3">
            {moves.map((move, index) => (
              <div key={index} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]">
                <Field label="Staff member">
                  <Select
                    value={move.staffId || "__none__"}
                    onValueChange={(staffId) => updateMove(index, { staffId: staffId === "__none__" ? "" : staffId })}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Choose staff" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Choose staff</SelectItem>
                      {staffRecords.map((person) => (
                        <SelectItem key={person.id} value={person.id}>
                          {person.firstName} {person.lastName} ({person.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Destination unit">
                  <OrgUnitSelect
                    units={units}
                    value={move.toUnitId}
                    onChange={(toUnitId) => updateMove(index, { toUnitId })}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    variant="outline"
                    disabled={moves.length === 1}
                    onClick={() => setMoves((current) => current.filter((_, row) => row !== index))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMoves((current) => [...current, { staffId: "", toUnitId: "" }])}>
              Add move
            </Button>
            <Button onClick={createDraft} disabled={saving || !facilityDate}>{saving ? "Saving..." : editingBatchId ? "Save draft changes" : "Save draft"}</Button>
            {editingBatchId ? <Button variant="outline" onClick={() => {
              setEditingBatchId("");
              setTitle("");
              setEffectiveFrom(facilityDate);
              setMoves([{ staffId: "", toUnitId: "" }]);
            }}>Cancel edit</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Transfer batches</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reshuffle drafts yet.</p>
          ) : batches.map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">{batch.title}</p>
                <p className="text-sm text-muted-foreground">
                  Effective {batch.effectiveFrom} · {batch.items.length} staff · {batch.status}
                </p>
                <p className="text-sm">
                  {batch.items.map((item) =>
                    `${item.staffName} ${item.staffLastName} → ${item.toUnitName}`,
                  ).join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => loadPreview(batch.id)} disabled={saving}>Preview</Button>
                {batch.status === "DRAFT" ? (
                  <>
                    <Button variant="outline" disabled={saving} onClick={() => editDraft(batch)}>Edit draft</Button>
                    <Button
                      variant="outline"
                      disabled={saving || previewedBatchId !== batch.id}
                      onClick={() => void transitionBatchFor(batch.id, "approve")}
                    >
                      Approve
                    </Button>
                  </>
                ) : null}
                {batch.status === "APPROVED" ? (
                  <>
                    <Button
                      disabled={saving || previewedBatchId !== batch.id}
                      onClick={() => void transitionBatchFor(batch.id, "apply")}
                    >
                      Apply
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => void transitionBatchFor(batch.id, "cancel")}
                    >
                      Cancel batch
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>Coverage preview{selectedBatch ? ` — ${selectedBatch.title}` : ""}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {preview.moves.map((move, index) => (
                <p key={`${move.employeeId}-${index}`} className="text-sm">
                  <span className="font-medium">{move.staffName} ({move.employeeId})</span>
                  {" · "}{move.fromUnit} → {move.toUnit}
                </p>
              ))}
            </div>
            {preview.coverage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No staffing minimums are configured for affected units.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b">
                    <th className="p-2">Unit / shift / role</th>
                    <th className="p-2">Minimum</th>
                    <th className="p-2">Current</th>
                    <th className="p-2">After reshuffle</th>
                    <th className="p-2">Coverage impact</th>
                  </tr></thead>
                  <tbody>{preview.coverage.map((row, index) => (
                    <tr key={`${row.unitName}-${row.shiftName}-${row.roleName}-${index}`} className="border-b">
                      <td className="p-2">{row.unitName} · {row.shiftName} · {row.roleName}</td>
                      <td className="p-2">{row.minimum}</td>
                      <td className="p-2">{row.currentStaff} {row.currentShortfall ? `(${row.currentShortfall} short)` : ""}</td>
                      <td className="p-2">{row.projectedStaff} {row.projectedShortfall ? `(${row.projectedShortfall} short)` : ""}</td>
                      <td className="p-2">{row.impact}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </ListView>
  );

  function updateMove(index: number, patch: Partial<BatchMove>) {
    setMoves((current) => current.map((move, row) => row === index ? { ...move, ...patch } : move));
  }

  async function transitionBatchFor(batchId: string, action: "approve" | "apply" | "cancel") {
    setActiveBatchId(batchId);
    try {
      setSaving(true);
      await request<BatchEnvelope>(`transfer-batches/${batchId}/${action}`, { method: "POST" });
      notify?.({
        type: "success",
        message:
          action === "approve"
            ? "Batch approved."
            : action === "apply"
              ? "Batch applied atomically."
              : "Batch cancelled.",
      });
      await loadBatches();
      setPreviewedBatchId("");
      if (action !== "approve") setPreview(null);
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : `Failed to ${action} batch.` });
    } finally {
      setSaving(false);
    }
  }
};

async function fetchAllStaff() {
  const records: StaffRecord[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(`${apiBase}/v1/staff?page=${page}&limit=200`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as StaffEnvelope;
    if (!response.ok) throw new Error(errorMessage(payload, "Failed to load staff."));
    records.push(...(payload.data ?? []));
    if (!payload.pagination?.hasMore) return records;
    page += 1;
  }
}

async function fetchAllOrgUnits() {
  const units: OrgUnitRecord[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(`${apiBase}/v1/org-units?page=${page}&limit=200`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as UnitEnvelope & { pagination?: { hasMore?: boolean } };
    if (!response.ok) throw new Error(errorMessage(payload, "Failed to load org units."));
    units.push(...(payload.data ?? []));
    if (!payload.pagination?.hasMore) return units;
    page += 1;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function OrgUnitSelect({
  units,
  value,
  onChange,
}: {
  units: OrgUnitRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(next) => onChange(next === "__none__" ? "" : next)}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Choose an org unit" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Choose an org unit</SelectItem>
        {units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name} ({unit.code})</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
