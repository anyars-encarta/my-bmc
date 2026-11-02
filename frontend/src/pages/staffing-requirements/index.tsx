import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNotification } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { JobRoleRecord, OrgUnitRecord, ShiftTypeRecord } from "@/types/domain";
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

type Requirement = {
  id: string;
  orgUnitId: string;
  unitName: string;
  unitCode: string;
  shiftTypeId: string;
  shiftName: string;
  jobRoleId: string | null;
  roleName: string | null;
  minStaff: number;
};
type RequirementForm = {
  orgUnitId: string;
  shiftTypeId: string;
  jobRoleId: string;
  minStaff: string;
};
type Envelope<T> = { data?: T; message?: string; error?: string; pagination?: { hasMore?: boolean } };

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const emptyForm = (): RequirementForm => ({ orgUnitId: "", shiftTypeId: "", jobRoleId: "", minStaff: "1" });
const getErrorMessage = (payload: { message?: string; error?: string }, fallback: string) =>
  payload.message || payload.error || fallback;

export const StaffingRequirementsPage = () => {
  const { open: notify } = useNotification();
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [shifts, setShifts] = useState<ShiftTypeRecord[]>([]);
  const [roles, setRoles] = useState<JobRoleRecord[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [form, setForm] = useState<RequirementForm>(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as Envelope<T>;
    if (!response.ok) throw new Error(getErrorMessage(payload, "The request failed."));
    return payload;
  }, []);

  const loadRequirements = useCallback(async () => {
    const payload = await request<Requirement[]>("unit-staffing-requirements");
    setRequirements(payload.data ?? []);
  }, [request]);

  useEffect(() => {
    const loadReferences = async () => {
      try {
        const [allUnits, allShifts, allRoles] = await Promise.all([
          fetchAll<OrgUnitRecord>("org-units"),
          fetchAll<ShiftTypeRecord>("shift-types"),
          fetchAll<JobRoleRecord>("job-roles"),
        ]);
        setUnits(allUnits.filter((unit) => unit.active));
        setShifts(allShifts.filter((shift) => shift.active));
        setRoles(allRoles);
      } catch (error) {
        notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load staffing references." });
      }
    };
    loadReferences();
    loadRequirements().catch((error) =>
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load minimums." }),
    );
  }, [loadRequirements, notify]);

  const submit = async () => {
    const minStaff = form.minStaff.trim();
    const minimum = Number(minStaff);
    if (!form.orgUnitId || !form.shiftTypeId || !minStaff || !Number.isInteger(minimum) || minimum < 0) {
      notify?.({ type: "error", message: "Choose a unit and shift, and enter a non-negative whole-number minimum." });
      return;
    }
    try {
      setSaving(true);
      await request<Requirement>(editingId ? `unit-staffing-requirements/${editingId}` : "unit-staffing-requirements", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          orgUnitId: form.orgUnitId,
          shiftTypeId: form.shiftTypeId,
          jobRoleId: form.jobRoleId || null,
          minStaff: minimum,
        }),
      });
      notify?.({ type: "success", message: editingId ? "Minimum updated." : "Minimum created." });
      cancelEdit();
      await loadRequirements();
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to save minimum." });
    } finally {
      setSaving(false);
    }
  };

  const edit = (requirement: Requirement) => {
    setEditingId(requirement.id);
    setForm({
      orgUnitId: requirement.orgUnitId,
      shiftTypeId: requirement.shiftTypeId,
      jobRoleId: requirement.jobRoleId ?? "",
      minStaff: String(requirement.minStaff),
    });
  };

  const remove = async (requirement: Requirement) => {
    try {
      setSaving(true);
      await request<Requirement>(`unit-staffing-requirements/${requirement.id}`, { method: "DELETE" });
      notify?.({ type: "success", message: "Minimum removed." });
      await loadRequirements();
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to remove minimum." });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditingId("");
    setForm(emptyForm());
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Minimum staffing requirements" />
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit staffing minimum" : "Add staffing minimum"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Org unit">
            <Select value={form.orgUnitId || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, orgUnitId: value === "__none__" ? "" : value }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a unit" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Choose a unit</SelectItem>
                {units.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name} ({unit.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Shift">
            <Select value={form.shiftTypeId || "__none__"} onValueChange={(value) => setForm((current) => ({ ...current, shiftTypeId: value === "__none__" ? "" : value }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose a shift" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Choose a shift</SelectItem>
                {shifts.map((shift) => <SelectItem key={shift.id} value={shift.id}>{shift.name} ({shift.startTime}–{shift.endTime})</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Job role (optional)">
            <Select value={form.jobRoleId || "__all__"} onValueChange={(value) => setForm((current) => ({ ...current, jobRoleId: value === "__all__" ? "" : value }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All roles</SelectItem>
                {roles.map((role) => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Minimum staff">
            <Input type="number" min={0} step={1} value={form.minStaff} onChange={(event) => setForm((current) => ({ ...current, minStaff: event.target.value }))} />
          </Field>
          <div className="flex gap-2 md:col-span-2">
            <Button onClick={submit} disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add minimum"}</Button>
            {editingId ? <Button variant="outline" onClick={cancelEdit} disabled={saving}>Cancel</Button> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configured minimums</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No staffing minimums configured.</p>
          ) : requirements.map((requirement) => (
            <div key={requirement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">{requirement.unitName} ({requirement.unitCode}) · {requirement.shiftName}</p>
                <p className="text-sm text-muted-foreground">{requirement.roleName ?? "All roles"} · Minimum {requirement.minStaff}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" disabled={saving} onClick={() => edit(requirement)}>Edit</Button>
                <Button variant="destructive" disabled={saving} onClick={() => void remove(requirement)}>Remove</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </ListView>
  );
};

async function fetchAll<T>(resource: string): Promise<T[]> {
  const records: T[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(`${apiBase}/v1/${resource}?page=${page}&limit=200`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as Envelope<T[]>;
    if (!response.ok) throw new Error(getErrorMessage(payload, `Failed to load ${resource}.`));
    records.push(...(payload.data ?? []));
    if (!payload.pagination?.hasMore) return records;
    page += 1;
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
