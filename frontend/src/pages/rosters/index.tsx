import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { toast } from "sonner";

import { BACKEND_BASE_URL } from "@/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { createAuthHeaders } from "@/providers/me";

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
  message?: string;
  violations?: Violation[];
  warnings?: string[];
  valid?: boolean;
  pagination?: { hasMore?: boolean };
};
type Violation = {
  level: "error" | "warning";
  code: string;
  message: string;
  staffId: string | null;
  date: string;
};
type Unit = { id: string; name: string; code: string; active: boolean };
type Shift = { id: string; name: string; code: string; category: string; startTime: string; endTime: string; active: boolean };
type StaffRow = {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  staffCategory: string;
  jobRoleName: string | null;
  scheduleMode: string;
};
type Period = {
  id: string;
  orgUnitId: string;
  unitName: string;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "PUBLISHED" | "LOCKED";
};
type GridEntry = {
  id: string;
  staffId: string;
  rosterDate: string;
  shiftTypeId: string;
  shiftName: string;
  plannedStart: string;
  plannedEnd: string;
  source: string;
  version: number;
  overrideReason: string | null;
};
type GridData = {
  period: Period;
  dates: string[];
  staff: StaffRow[];
  shifts: Shift[];
  entries: GridEntry[];
  violations: Violation[];
};
type Template = { id: string; orgUnitId: string; unitName: string; name: string };
type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester: { employeeId: string; name: string; date: string; shift: string };
  counterparty: { employeeId: string; name: string; date: string; shift: string } | null;
};

class RosterApiError extends Error {
  constructor(readonly payload: ApiEnvelope<unknown>, message: string) {
    super(message);
  }
}

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const ROW_HEIGHT = 76;
const OVERSCAN = 6;
const cellKey = (staffId: string, date: string) => `${staffId}:${date}`;
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GH", { weekday: "short", day: "2-digit", month: "short" })
    .format(new Date(`${date}T00:00:00`));
const addDays = (date: string, count: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};
const sameCellValues = (left: string[] = [], right: string[] = []) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const RostersPage = () => {
  const { data: identity } = useGetIdentity<{ role?: string; roles?: string[] }>();
  const roles = identity?.roles ?? (identity?.role ? [identity.role] : []);
  const canEdit = roles.some((role) =>
    ["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER"].includes(role),
  );
  const canOverrideRest = roles.some((role) => ["SUPER_ADMIN", "HR_MANAGER"].includes(role));
  const canPublish = roles.some((role) =>
    ["SUPER_ADMIN", "HR_MANAGER", "UNIT_MANAGER"].includes(role),
  );

  const [units, setUnits] = useState<Unit[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([]);
  const [unitId, setUnitId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [grid, setGrid] = useState<GridData | null>(null);
  const [cells, setCells] = useState<Record<string, string[]>>({});
  const [savedCells, setSavedCells] = useState<Record<string, string[]>>({});
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => addDays(new Date().toISOString().slice(0, 10), 6));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const [paintShiftId, setPaintShiftId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [sourcePeriodId, setSourcePeriodId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [showViolations, setShowViolations] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const gridViewport = useRef<HTMLDivElement>(null);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok) {
      throw new RosterApiError(payload, payload.message || payload.error || "The roster request failed.");
    }
    return payload;
  }, []);

  const fetchAll = useCallback(async <T,>(resource: string) => {
    const records: T[] = [];
    for (let page = 1; ; page += 1) {
      const payload = await request<T[]>(`${resource}?page=${page}&limit=200`);
      records.push(...(payload.data ?? []));
      if (!payload.pagination?.hasMore) return records;
    }
  }, [request]);

  const loadPeriods = useCallback(async (forUnitId = unitId) => {
    const suffix = forUnitId ? `?orgUnitId=${encodeURIComponent(forUnitId)}` : "";
    const payload = await request<Period[]>(`roster-periods${suffix}`);
    setPeriods(payload.data ?? []);
  }, [request, unitId]);

  const loadTemplates = useCallback(async (forUnitId = unitId) => {
    if (!forUnitId) {
      setTemplates([]);
      return;
    }
    const payload = await request<Template[]>(`roster-templates?orgUnitId=${encodeURIComponent(forUnitId)}`);
    setTemplates(payload.data ?? []);
  }, [request, unitId]);

  const loadSwapRequests = useCallback(async () => {
    if (!canPublish) return;
    const payload = await request<SwapRequest[]>("shift-swaps");
    setSwapRequests(payload.data ?? []);
  }, [canPublish, request]);

  const loadGrid = useCallback(async (selectedPeriodId: string) => {
    if (!selectedPeriodId) {
      setGrid(null);
      setCells({});
      setSavedCells({});
      return;
    }
    setLoading(true);
    try {
      const payload = await request<GridData>(`roster-periods/${selectedPeriodId}/grid`);
      const nextGrid = payload.data;
      if (!nextGrid) throw new Error("The roster grid response was empty.");
      const nextCells: Record<string, string[]> = {};
      for (const entry of nextGrid.entries) {
        const key = cellKey(entry.staffId, entry.rosterDate);
        nextCells[key] = [...(nextCells[key] ?? []), entry.shiftTypeId];
      }
      setGrid(nextGrid);
      setCells(nextCells);
      setSavedCells(nextCells);
      setUnitId(nextGrid.period.orgUnitId);
      setOverrideReason("");
      setChangeReason("");
      setScrollTop(0);
      if (gridViewport.current) gridViewport.current.scrollTop = 0;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load roster grid.");
      setGrid(null);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const loadReferences = async () => {
      try {
        const [unitRows, shiftRows, periodPayload] = await Promise.all([
          fetchAll<Unit>("org-units"),
          fetchAll<Shift>("shift-types"),
          request<Period[]>("roster-periods"),
        ]);
        setUnits(unitRows.filter((unit) => unit.active));
        setShifts(shiftRows.filter((shift) => shift.active));
        setPeriods(periodPayload.data ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to load roster references.");
      }
    };
    void loadReferences();
  }, [fetchAll, request]);

  useEffect(() => {
    if (unitId) void loadTemplates(unitId).catch((error) =>
      toast.error(error instanceof Error ? error.message : "Unable to load weekly templates."),
    );
  }, [loadTemplates, unitId]);

  useEffect(() => {
    void loadSwapRequests().catch((error) =>
      toast.error(error instanceof Error ? error.message : "Unable to load shift swaps."),
    );
  }, [loadSwapRequests]);

  const periodOptions = useMemo(() =>
    periods.filter((period) => !unitId || period.orgUnitId === unitId),
  [periods, unitId]);
  const dirtyKeys = useMemo(() => {
    const keys = new Set([...Object.keys(cells), ...Object.keys(savedCells)]);
    return Array.from(keys).filter((key) => !sameCellValues(cells[key], savedCells[key]));
  }, [cells, savedCells]);
  useEffect(() => {
    if (dirtyKeys.length === 0) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirtyKeys.length]);
  const visibleRange = useMemo(() => {
    if (!grid) return { start: 0, end: 0 };
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const viewportHeight = gridViewport.current?.clientHeight ?? 600;
    const end = Math.min(grid.staff.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
    return { start, end };
  }, [grid, scrollTop]);
  const visibleStaff = grid?.staff.slice(visibleRange.start, visibleRange.end) ?? [];
  const staffById = useMemo(() => new Map((grid?.staff ?? []).map((person) => [person.id, person])), [grid]);
  const shiftById = useMemo(() => new Map(shifts.map((shift) => [shift.id, shift])), [shifts]);

  const setCell = (key: string, value: string[]) =>
    setCells((current) => ({ ...current, [key]: value }));

  const updateCellShift = (key: string, index: number, value: string) => {
    const current = cells[key] ?? [];
    const next = [...current];
    if (value) {
      if (next.some((shiftId, currentIndex) => currentIndex !== index && shiftId === value)) return;
      next[index] = value;
    } else {
      next.splice(index, 1);
    }
    setCell(key, next);
  };

  const createPeriod = async () => {
    if (!unitId) {
      toast.error("Choose an org unit first.");
      return;
    }
    setSaving(true);
    try {
      const payload = await request<Period>("roster-periods", {
        method: "POST",
        body: JSON.stringify({ orgUnitId: unitId, startDate, endDate }),
      });
      if (!payload.data) throw new Error("The roster period response was empty.");
      await loadPeriods(unitId);
      setPeriodId(payload.data.id);
      await loadGrid(payload.data.id);
      toast.success("Draft roster period created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create roster period.");
    } finally {
      setSaving(false);
    }
  };

  const saveChanges = async () => {
    if (!grid || !periodId || dirtyKeys.length === 0) return;
    const entries = dirtyKeys.flatMap((key) => {
      const [staffId = "", rosterDate = ""] = key.split(":");
      const selectedShifts = (cells[key] ?? []).filter(Boolean);
      const values = selectedShifts.length > 0 ? selectedShifts : [null];
      return values.map((shiftTypeId) => ({
        staffId,
        rosterDate,
        shiftTypeId,
        ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
      }));
    });
    setSaving(true);
    try {
      const payload = await request<{ changedCells: number }>(`roster-periods/${periodId}/entries`, {
        method: "PUT",
        body: JSON.stringify({
          entries,
          ...(changeReason.trim() ? { reason: changeReason.trim() } : {}),
        }),
      });
      setShowViolations(true);
      setGrid((current) => current ? { ...current, violations: payload.violations ?? [] } : current);
      if (payload.warnings?.length) payload.warnings.forEach((warning) => toast.warning(warning));
      else toast.success(`Saved ${payload.data?.changedCells ?? 0} roster cell(s).`);
      await loadGrid(periodId);
      await loadPeriods(unitId);
    } catch (error) {
      if (error instanceof RosterApiError && error.payload.violations) {
        setGrid((current) => current ? { ...current, violations: error.payload.violations ?? [] } : current);
        setShowViolations(true);
      }
      toast.error(error instanceof Error ? error.message : "Unable to save roster.");
    } finally {
      setSaving(false);
    }
  };

  const validatePeriod = async () => {
    if (!periodId) return;
    setSaving(true);
    try {
      const payload = await request<Violation[]>(`roster-periods/${periodId}/validate`, { method: "POST" });
      const violations = payload.data ?? [];
      setGrid((current) => current ? { ...current, violations } : current);
      setShowViolations(true);
      toast[violations.some((item) => item.level === "error") ? "error" : "success"](
        violations.length === 0 ? "No roster violations found." : `${violations.length} roster issue(s) found.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to validate roster.");
    } finally {
      setSaving(false);
    }
  };

  const publishPeriod = async () => {
    if (!periodId) return;
    setSaving(true);
    try {
      const payload = await request<Period>(`roster-periods/${periodId}/publish`, { method: "POST" });
      payload.warnings?.forEach((warning) => toast.warning(warning));
      if (!payload.warnings?.length) toast.success("Roster published. Staff were notified in-app.");
      await loadPeriods(unitId);
      await loadGrid(periodId);
    } catch (error) {
      if (error instanceof RosterApiError && error.payload.violations) {
        setGrid((current) => current ? { ...current, violations: error.payload.violations ?? [] } : current);
        setShowViolations(true);
      }
      toast.error(error instanceof Error ? error.message : "Unable to publish roster.");
    } finally {
      setSaving(false);
    }
  };

  const lockPeriod = async () => {
    if (!periodId) return;
    setSaving(true);
    try {
      await request<Period>(`roster-periods/${periodId}/lock`, { method: "POST" });
      toast.success("Roster locked.");
      await loadPeriods(unitId);
      await loadGrid(periodId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to lock roster.");
    } finally {
      setSaving(false);
    }
  };

  const copyPeriod = async () => {
    if (!periodId || !sourcePeriodId) {
      toast.error("Choose the period to copy.");
      return;
    }
    setSaving(true);
    try {
      const payload = await request<{ changedCells: number }>(`roster-periods/${periodId}/copy`, {
        method: "POST",
        body: JSON.stringify({ sourcePeriodId }),
      });
      toast.success(`Copied ${payload.data?.changedCells ?? 0} roster cell(s).`);
      await loadGrid(periodId);
    } catch (error) {
      if (error instanceof RosterApiError && error.payload.violations) {
        setGrid((current) => current ? { ...current, violations: error.payload.violations ?? [] } : current);
        setShowViolations(true);
      }
      toast.error(error instanceof Error ? error.message : "Unable to copy the roster.");
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    if (!grid || !templateName.trim()) {
      toast.error("Enter a template name.");
      return;
    }
    const entries: Array<{ staffId: string; dayOfWeek: number; shiftTypeId: string }> = [];
    for (const person of grid.staff) {
      const byDay = new Map<number, string>();
      for (const date of grid.dates) {
        const selectedShift = cells[cellKey(person.id, date)]?.[0];
        if (selectedShift) {
          const dayOfWeek = new Date(`${date}T00:00:00.000Z`).getUTCDay();
          const existingShift = byDay.get(dayOfWeek);
          if (existingShift && existingShift !== selectedShift) {
            toast.error(`${person.firstName} ${person.lastName} has different shifts on the same weekday; the template was not saved.`);
            return;
          }
          byDay.set(dayOfWeek, selectedShift);
        }
      }
      for (const [dayOfWeek, shiftTypeId] of byDay) {
        entries.push({ staffId: person.id, dayOfWeek, shiftTypeId });
      }
    }
    setSaving(true);
    try {
      await request<Template>("roster-templates", {
        method: "POST",
        body: JSON.stringify({ orgUnitId: grid.period.orgUnitId, name: templateName.trim(), entries }),
      });
      toast.success("Weekly template saved.");
      setTemplateName("");
      await loadTemplates(grid.period.orgUnitId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save template.");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async () => {
    if (!periodId || !templateId) {
      toast.error("Choose a weekly template.");
      return;
    }
    setSaving(true);
    try {
      const payload = await request<{ changedCells: number }>(`roster-periods/${periodId}/apply-template`, {
        method: "POST",
        body: JSON.stringify({ templateId }),
      });
      toast.success(`Applied template to ${payload.data?.changedCells ?? 0} roster cell(s).`);
      await loadGrid(periodId);
    } catch (error) {
      if (error instanceof RosterApiError && error.payload.violations) {
        setGrid((current) => current ? { ...current, violations: error.payload.violations ?? [] } : current);
        setShowViolations(true);
      }
      toast.error(error instanceof Error ? error.message : "Unable to apply template.");
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async () => {
    if (!templateId) return;
    setSaving(true);
    try {
      await request<Template>(`roster-templates/${templateId}`, { method: "DELETE" });
      toast.success("Weekly template removed.");
      setTemplateId("");
      await loadTemplates(unitId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove template.");
    } finally {
      setSaving(false);
    }
  };

  const updateSwap = async (swapId: string, action: "approve" | "reject") => {
    setSaving(true);
    try {
      const payload = await request<SwapRequest>(`shift-swaps/${swapId}/${action}`, { method: "POST" });
      payload.warnings?.forEach((warning) => toast.warning(warning));
      if (!payload.warnings?.length) toast.success(action === "approve" ? "Shift swap approved." : "Shift swap rejected.");
      await loadSwapRequests();
      if (periodId) await loadGrid(periodId);
    } catch (error) {
      if (error instanceof RosterApiError && error.payload.violations) {
        setGrid((current) => current ? { ...current, violations: error.payload.violations ?? [] } : current);
        setShowViolations(true);
      }
      toast.error(error instanceof Error ? error.message : "Unable to update shift swap.");
    } finally {
      setSaving(false);
    }
  };

  const violations = grid?.violations ?? [];
  const topSpacer = grid ? visibleRange.start * ROW_HEIGHT : 0;
  const bottomSpacer = grid ? (grid.staff.length - visibleRange.end) * ROW_HEIGHT : 0;

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Rosters" />

      <Card>
        <CardHeader><CardTitle>Roster period</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Org unit">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={unitId} onChange={(event) => {
              const nextUnit = event.target.value;
              if (nextUnit === unitId) return;
              if (dirtyKeys.length > 0 && !window.confirm("Discard unsaved roster changes?")) return;
              setUnitId(nextUnit);
              setPeriodId("");
              setGrid(null);
              setCells({});
              setSavedCells({});
              void loadPeriods(nextUnit).catch((error) => toast.error(error.message));
            }}>
              <option value="">Choose an org unit</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.code})</option>)}
            </select>
          </Field>
          <Field label="Existing period">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={periodId} onChange={(event) => {
              const nextId = event.target.value;
              if (nextId === periodId) return;
              if (dirtyKeys.length > 0 && !window.confirm("Discard unsaved roster changes?")) return;
              setPeriodId(nextId);
              void loadGrid(nextId);
            }}>
              <option value="">Choose a roster period</option>
              {periodOptions.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.unitName} · {period.startDate} – {period.endDate} · {period.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="New period starts">
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </Field>
          <Field label="New period ends">
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </Field>
          {canEdit ? (
            <div className="flex items-end md:col-span-2">
              <Button onClick={() => void createPeriod()} disabled={saving || !unitId} className="cursor-pointer">
                Create draft period
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {grid ? (
        <>
          <Card>
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>{grid.period.unitName} · {grid.period.startDate} – {grid.period.endDate}</CardTitle>
                <span className="rounded-full border px-3 py-1 text-sm font-medium">{grid.period.status}</span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {canEdit && grid.period.status !== "LOCKED" ? (
                  <>
                    <Field label="Copy previous period">
                      <select className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm" value={sourcePeriodId} onChange={(event) => setSourcePeriodId(event.target.value)}>
                        <option value="">Choose a period</option>
                        {periodOptions.filter((period) => period.id !== periodId).map((period) => (
                          <option key={period.id} value={period.id}>{period.startDate} – {period.endDate} · {period.status}</option>
                        ))}
                      </select>
                    </Field>
                    <Button variant="outline" onClick={() => void copyPeriod()} disabled={saving || !sourcePeriodId}>Copy period</Button>
                    <Field label="Weekly template">
                      <select className="h-9 min-w-44 rounded-md border bg-background px-3 text-sm" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                        <option value="">Choose a template</option>
                        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                      </select>
                    </Field>
                    <Button variant="outline" onClick={() => void applyTemplate()} disabled={saving || !templateId}className="cursor-pointer">Apply template</Button>
                    {templateId ? <Button variant="outline" onClick={() => void removeTemplate()} disabled={saving} className="cursor-pointer">Remove template</Button> : null}
                    <div className="flex items-end gap-2">
                      <Field label="Save current week as template">
                        <Input value={templateName} maxLength={100} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" />
                      </Field>
                      <Button variant="outline" onClick={() => void saveTemplate()} disabled={saving || !templateName.trim()} className="cursor-pointer">Save template</Button>
                    </div>
                  </>
                ) : null}
              </div>
              {canEdit && grid.period.status !== "LOCKED" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex h-9 items-center gap-2 text-sm">
                    <input type="checkbox" checked={paintMode} onChange={(event) => setPaintMode(event.target.checked)} />
                    Paint mode
                  </label>
                  <Field label="Paint with">
                    <select className="h-9 min-w-40 rounded-md border bg-background px-3 text-sm" value={paintShiftId} onChange={(event) => setPaintShiftId(event.target.value)}>
                      <option value="">Off day</option>
                      {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
                    </select>
                  </Field>
                  {canOverrideRest ? (
                    <Field label="HR rest-rule override reason">
                      <Input value={overrideReason} maxLength={500} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Required to override minimum rest" />
                    </Field>
                  ) : null}
                  {grid.period.status === "PUBLISHED" ? (
                    <Field label="Published-roster change reason">
                      <Input value={changeReason} maxLength={500} onChange={(event) => setChangeReason(event.target.value)} placeholder="Optional audit note" />
                    </Field>
                  ) : null}
                  <Button onClick={() => void saveChanges()} disabled={saving || dirtyKeys.length === 0} className="cursor-pointer">
                    {saving ? "Saving..." : `Save changes${dirtyKeys.length ? ` (${dirtyKeys.length})` : ""}`}
                  </Button>
                  <Button variant="outline" onClick={() => void validatePeriod()} disabled={saving} className="cursor-pointer">Validate</Button>
                  {canPublish && grid.period.status === "DRAFT" ? (
                    <Button onClick={() => void publishPeriod()} disabled={saving || dirtyKeys.length > 0} className="cursor-pointer">Publish</Button>
                  ) : null}
                  {canPublish && grid.period.status === "PUBLISHED" ? (
                    <Button variant="outline" onClick={() => void lockPeriod()} disabled={saving} className="cursor-pointer">Lock roster</Button>
                  ) : null}
                </div>
              ) : canPublish && grid.period.status === "PUBLISHED" ? (
                <Button variant="outline" onClick={() => void lockPeriod()} disabled={saving} className="cursor-pointer">Lock roster</Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {loading ? <p className="py-8 text-center text-sm text-muted-foreground">Loading roster…</p> : (
                <div
                  ref={gridViewport}
                  className="max-h-[70vh] overflow-auto rounded-md border"
                  onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-muted">
                      <tr>
                        <th className="sticky left-0 z-20 min-w-56 border-b border-r bg-muted p-2 text-left">Staff member</th>
                        {grid.dates.map((date) => <th key={date} className="min-w-36 border-b border-r p-2 text-left">{dateLabel(date)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {topSpacer > 0 ? <tr aria-hidden="true"><td colSpan={grid.dates.length + 1} style={{ height: topSpacer, padding: 0, border: 0, lineHeight: 0 }} /></tr> : null}
                      {visibleStaff.map((person) => (
                        <tr key={person.id} style={{ height: ROW_HEIGHT }}>
                          <th className="sticky left-0 z-1 border-b border-r bg-background p-2 text-left align-top">
                            <span className="block font-medium">{person.firstName} {person.lastName}</span>
                            <span className="block text-xs text-muted-foreground">Staff ID: {person.employeeId}</span>
                            <span className="block text-xs text-muted-foreground">{person.jobRoleName ?? person.staffCategory}</span>
                          </th>
                          {grid.dates.map((date) => {
                            const key = cellKey(person.id, date);
                            const selected = cells[key] ?? [];
                            const cellViolations = violations.filter((item) => item.staffId === person.id && item.date === date);
                            const paint = () => setCell(key, paintShiftId ? [paintShiftId] : []);
                            return (
                              <td
                                key={date}
                                className={`h-[76px] max-h-[76px] border-b border-r p-1 align-top ${cellViolations.some((item) => item.level === "error") ? "bg-destructive/10" : cellViolations.length ? "bg-amber-500/10" : ""}`}
                                onClick={paintMode && !saving ? paint : undefined}
                                title={paintMode ? "Click to paint this shift" : undefined}
                              >
                                <div className="max-h-[64px] overflow-y-auto">
                                {paintMode ? (
                                  <span className="text-xs text-muted-foreground">
                                    {selected.map((id) => shiftById.get(id)?.name).filter(Boolean).join(" + ") || "Off"}
                                  </span>
                                ) : canEdit && grid.period.status !== "LOCKED" ? (
                                  <div className="space-y-1">
                                    {(selected.length > 0 ? selected : [""]).map((selectedShift, index) => (
                                      <div key={`${key}-${index}`} className="flex items-center gap-1">
                                        <select
                                          aria-label={`${person.firstName} ${person.lastName} ${date} shift ${index + 1}`}
                                          className="h-8 min-w-28 rounded border bg-background px-1 text-xs"
                                          value={selectedShift}
                                          onChange={(event) => updateCellShift(key, index, event.target.value)}
                                        >
                                          <option value="">Off day</option>
                                          {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
                                        </select>
                                        {index > 0 ? <button type="button" className="px-1 text-muted-foreground" aria-label="Remove shift" onClick={() => updateCellShift(key, index, "")}>×</button> : null}
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="text-xs text-primary underline cursor-pointer"
                                      onClick={() => setCell(key, [...selected, ""])}
                                    >
                                      Add shift
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-xs">{selected.map((id) => shiftById.get(id)?.name).filter(Boolean).join(" + ") || "Off"}</span>
                                )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {bottomSpacer > 0 ? <tr aria-hidden="true"><td colSpan={grid.dates.length + 1} style={{ height: bottomSpacer, padding: 0, border: 0, lineHeight: 0 }} /></tr> : null}
                      {grid.staff.length === 0 ? <tr><td colSpan={grid.dates.length + 1} className="p-8 text-center text-muted-foreground">No rostered staff are assigned to this unit during this period.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Roster violations ({violations.length})</CardTitle>
              <Button variant="outline" onClick={() => setShowViolations((visible) => !visible)} className="cursor-pointer">
                {showViolations ? "Hide details" : "Show details"}
              </Button>
            </CardHeader>
            {showViolations ? (
              <CardContent className="space-y-2">
                {violations.length === 0 ? <p className="text-sm text-muted-foreground">No violations found.</p> : violations.map((violation, index) => {
                  const person = violation.staffId ? staffById.get(violation.staffId) : null;
                  return (
                    <div key={`${violation.code}-${violation.date}-${violation.staffId}-${index}`} className={`rounded-md border p-3 text-sm ${violation.level === "error" ? "border-destructive/40" : "border-amber-500/40"}`}>
                      <span className="font-semibold">{violation.level.toUpperCase()}</span>
                      <span className="ml-2">{violation.message}</span>
                      <span className="ml-2 text-muted-foreground">{person ? `${person.firstName} ${person.lastName} · ` : ""}{violation.date}</span>
                    </div>
                  );
                })}
              </CardContent>
            ) : null}
          </Card>

          {canPublish ? (
            <Card>
              <CardHeader><CardTitle>Accepted shift swaps awaiting approval</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {swapRequests.filter((swap) => swap.status === "ACCEPTED" || swap.status === "PENDING").length === 0 ? (
                  <p className="text-sm text-muted-foreground">No shift swaps need review.</p>
                ) : swapRequests.filter((swap) => swap.status === "ACCEPTED" || swap.status === "PENDING").map((swap) => (
                  <div key={swap.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                    <div>
                      <p className="font-medium">{swap.requester.name} · {swap.requester.date} · {swap.requester.shift}</p>
                      <p className="text-sm text-muted-foreground">
                        {swap.counterparty ? `${swap.counterparty.name} · ${swap.counterparty.date} · ${swap.counterparty.shift}` : "No selected colleague"}
                        {" · "}{swap.status}{" · "}{swap.reason ?? ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {swap.status === "ACCEPTED" ? <Button disabled={saving} onClick={() => void updateSwap(swap.id, "approve")}>Approve</Button> : null}
                      <Button variant="outline" disabled={saving} onClick={() => void updateSwap(swap.id, "reject")} className="cursor-pointer">Reject</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : periodId ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">{loading ? "Loading roster…" : "Select a period to view its grid."}</CardContent></Card>
      ) : null}
    </ListView>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-40 space-y-1.5"><Label>{label}</Label>{children}</div>;
}
