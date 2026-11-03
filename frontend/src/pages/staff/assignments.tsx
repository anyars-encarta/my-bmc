import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useGetIdentity, useNotification } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import { fetchFacilityLocalDate } from "@/lib/facility-clock";
import { canWriteStaffAssignments } from "@/lib/workforce-access";
import type { OrgUnitRecord } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AssignmentRecord = {
  id: string;
  unitName: string;
  unitCode: string;
  assignmentType: "PRIMARY" | "TEMPORARY" | "COVER";
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  note: string | null;
};
type EffectiveAssignment = {
  unitName: string;
  unitCode: string;
  assignmentType: "PRIMARY" | "TEMPORARY" | "COVER";
} | null;

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

const getErrorMessage = (payload: { message?: string; error?: string }, fallback: string) =>
  payload.message || payload.error || fallback;

export const StaffAssignments = ({ staffId }: { staffId: string }) => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<{ role?: string; roles?: string[] }>();
  const canWriteAssignments = canWriteStaffAssignments(identity);
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [records, setRecords] = useState<AssignmentRecord[]>([]);
  const [facilityDate, setFacilityDate] = useState("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [effectiveAssignment, setEffectiveAssignment] = useState<EffectiveAssignment>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [temporaryOpen, setTemporaryOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const effectiveUnitRequestId = useRef(0);
  const effectiveOnRef = useRef(effectiveOn);
  const [transfer, setTransfer] = useState({
    toUnitId: "",
    effectiveFrom: "",
    reason: "TRANSFER",
    note: "",
  });
  const [temporary, setTemporary] = useState({
    orgUnitId: "",
    assignmentType: "TEMPORARY" as "TEMPORARY" | "COVER",
    effectiveFrom: "",
    effectiveTo: "",
    note: "",
  });

  useEffect(() => {
    effectiveOnRef.current = effectiveOn;
  }, [effectiveOn]);

  const loadAssignments = useCallback(async () => {
    const response = await fetch(`${apiBase}/v1/staff/${staffId}/assignments`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as {
      data?: AssignmentRecord[];
      message?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to load assignment history."));
    setRecords(payload.data ?? []);
  }, [staffId]);

  const loadEffectiveUnit = useCallback(async (onDate: string) => {
    const requestId = ++effectiveUnitRequestId.current;
    try {
      const response = await fetch(
        `${apiBase}/v1/staff/${staffId}/effective-unit?on=${encodeURIComponent(onDate)}`,
        { credentials: "include", headers: createAuthHeaders() },
      );
      if (requestId !== effectiveUnitRequestId.current) return;
      const payload = (await response.json()) as {
        data?: { assignment: EffectiveAssignment };
        message?: string;
        error?: string;
      };
      if (requestId !== effectiveUnitRequestId.current) return;
      if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to resolve effective org unit."));
      setEffectiveAssignment(payload.data?.assignment ?? null);
    } catch (error) {
      if (requestId === effectiveUnitRequestId.current) throw error;
    }
  }, [staffId]);

  useEffect(() => {
    const loadReferences = async () => {
      try {
        const [allUnits, assignmentResponse, facilityDate] = await Promise.all([
          fetchAllUnits(),
          fetch(`${apiBase}/v1/staff/${staffId}/assignments`, {
            credentials: "include",
            headers: createAuthHeaders(),
          }),
          fetchFacilityLocalDate(),
        ]);
        const assignmentPayload = (await assignmentResponse.json()) as {
          data?: AssignmentRecord[];
          message?: string;
          error?: string;
        };
        if (!assignmentResponse.ok) {
          throw new Error(getErrorMessage(assignmentPayload, "Failed to load assignment history."));
        }
        setUnits(allUnits.filter((unit) => unit.active));
        setRecords(assignmentPayload.data ?? []);
        setFacilityDate(facilityDate);
        setEffectiveOn((value) => value || facilityDate);
        setTransfer((value) => ({ ...value, effectiveFrom: value.effectiveFrom || facilityDate }));
        setTemporary((value) => ({
          ...value,
          effectiveFrom: value.effectiveFrom || facilityDate,
          effectiveTo: value.effectiveTo || facilityDate,
        }));
      } catch (error) {
        notify?.({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load assignments.",
        });
      }
    };
    loadReferences();
  }, [notify, staffId]);

  useEffect(() => {
    if (!effectiveOn) return;
    loadEffectiveUnit(effectiveOn).catch((error) =>
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to resolve effective unit." }),
    );
  }, [effectiveOn, loadEffectiveUnit, notify]);

  const saveAssignment = async (kind: "transfer" | "temporary") => {
    const destination = kind === "transfer" ? transfer.toUnitId : temporary.orgUnitId;
    if (!destination) {
      notify?.({ type: "error", message: "Choose an org unit." });
      return;
    }

    try {
      setSaving(true);
      const response = await fetch(
        kind === "transfer"
          ? `${apiBase}/v1/staff/${staffId}/transfers`
          : `${apiBase}/v1/staff/${staffId}/assignments`,
        {
          method: "POST",
          credentials: "include",
          headers: createAuthHeaders(),
          body: JSON.stringify(
            kind === "transfer"
              ? {
                  toUnitId: transfer.toUnitId,
                  effectiveFrom: transfer.effectiveFrom,
                  reason: transfer.reason,
                  note: transfer.note.trim() || undefined,
                }
              : {
                  orgUnitId: temporary.orgUnitId,
                  assignmentType: temporary.assignmentType,
                  effectiveFrom: temporary.effectiveFrom,
                  effectiveTo: temporary.effectiveTo,
                  reason: temporary.assignmentType === "COVER" ? "COVER" : "SECONDMENT",
                  note: temporary.note.trim() || undefined,
                },
          ),
        },
      );
      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to save assignment."));
      notify?.({
        type: "success",
        message: kind === "transfer" ? "Transfer scheduled." : "Assignment added.",
      });
      if (kind === "transfer") setTransferOpen(false);
      else setTemporaryOpen(false);
      await loadAssignments();
      await loadEffectiveUnit(effectiveOnRef.current);
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to save assignment.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Assignments &amp; transfers</CardTitle>
        <div className="flex flex-wrap gap-2">
          {canWriteAssignments ? (
            <>
          <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer">Permanent transfer</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer staff member</DialogTitle>
                <DialogDescription>
                  The current unit remains effective until the selected date. Past dates are not allowed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <FieldLabel label="Destination unit">
                  <UnitSelect
                    units={units}
                    value={transfer.toUnitId}
                    onChange={(toUnitId) => setTransfer((value) => ({ ...value, toUnitId }))}
                  />
                </FieldLabel>
                <FieldLabel label="Effective from">
                  <Input
                    type="date"
                    min={facilityDate}
                    disabled={!facilityDate}
                    value={transfer.effectiveFrom}
                    onChange={(event) =>
                      setTransfer((value) => ({ ...value, effectiveFrom: event.target.value }))
                    }
                  />
                </FieldLabel>
                <FieldLabel label="Reason">
                  <Select
                    value={transfer.reason}
                    onValueChange={(reason) => setTransfer((value) => ({ ...value, reason }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["TRANSFER", "RESHUFFLE", "PROMOTION", "RETURN"].map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldLabel>
                <FieldLabel label="Note (optional)">
                  <Input
                    value={transfer.note}
                    onChange={(event) => setTransfer((value) => ({ ...value, note: event.target.value }))}
                  />
                </FieldLabel>
              </div>
              <DialogFooter>
                <Button onClick={() => saveAssignment("transfer")} disabled={saving} className="cursor-pointer">
                  {saving ? "Saving..." : "Schedule transfer"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={temporaryOpen} onOpenChange={setTemporaryOpen}>
            <DialogTrigger asChild>
              <Button className="cursor-pointer">Temporary / cover</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add temporary assignment</DialogTitle>
                <DialogDescription>
                  This assignment takes precedence over the primary unit for its date range.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <FieldLabel label="Assignment type">
                  <Select
                    value={temporary.assignmentType}
                    onValueChange={(assignmentType) => {
                      if (assignmentType === "TEMPORARY" || assignmentType === "COVER") {
                        setTemporary((value) => ({ ...value, assignmentType }));
                      }
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TEMPORARY">Temporary secondment</SelectItem>
                      <SelectItem value="COVER">Cover</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldLabel>
                <FieldLabel label="Org unit">
                  <UnitSelect
                    units={units}
                    value={temporary.orgUnitId}
                    onChange={(orgUnitId) => setTemporary((value) => ({ ...value, orgUnitId }))}
                  />
                </FieldLabel>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FieldLabel label="Start date">
                    <Input
                      type="date"
                      min={facilityDate}
                      disabled={!facilityDate}
                      value={temporary.effectiveFrom}
                      onChange={(event) =>
                        setTemporary((value) => ({ ...value, effectiveFrom: event.target.value }))
                      }
                    />
                  </FieldLabel>
                  <FieldLabel label="End date">
                    <Input
                      type="date"
                      min={temporary.effectiveFrom}
                      value={temporary.effectiveTo}
                      onChange={(event) =>
                        setTemporary((value) => ({ ...value, effectiveTo: event.target.value }))
                      }
                    />
                  </FieldLabel>
                </div>
                <FieldLabel label="Note (optional)">
                  <Input
                    value={temporary.note}
                    onChange={(event) => setTemporary((value) => ({ ...value, note: event.target.value }))}
                  />
                </FieldLabel>
              </div>
              <DialogFooter>
                <Button onClick={() => saveAssignment("temporary")} disabled={saving} className="cursor-pointer">
                  {saving ? "Saving..." : "Add assignment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="history" className="space-y-3">
          <TabsList>
            <TabsTrigger value="history">Assignment history</TabsTrigger>
            <TabsTrigger value="effective">Effective unit</TabsTrigger>
          </TabsList>
          <TabsContent value="history" className="space-y-3">
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assignment history recorded.</p>
            ) : (
              records.map((record) => (
                <div key={record.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{record.unitName} ({record.unitCode})</p>
                    <p className="text-sm text-muted-foreground">
                      {record.assignmentType} · {record.reason}
                    </p>
                    {record.note ? <p className="mt-1 text-sm">{record.note}</p> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {record.effectiveFrom} – {record.effectiveTo ?? "Ongoing"}
                  </p>
                </div>
              ))
            )}
          </TabsContent>
          <TabsContent value="effective" className="space-y-3">
            <FieldLabel label="Resolve assignment on">
              <Input
                type="date"
                value={effectiveOn}
                onChange={(event) => {
                  effectiveOnRef.current = event.target.value;
                  setEffectiveOn(event.target.value);
                }}
              />
            </FieldLabel>
            {effectiveAssignment ? (
              <div className="rounded-md border p-3">
                <p className="font-medium">{effectiveAssignment.unitName} ({effectiveAssignment.unitCode})</p>
                <p className="text-sm text-muted-foreground">{effectiveAssignment.assignmentType}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No assignment is effective on this date.</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function UnitSelect({
  units,
  value,
  onChange,
}: {
  units: OrgUnitRecord[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SearchableSelect
      value={value || "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? "" : next)}
      options={[
        { value: "__none__", label: "Choose a unit" },
        ...units.map((unit) => ({
          value: unit.id,
          label: `${unit.name} (${unit.code})`,
        })),
      ]}
      placeholder="Choose a unit"
      searchPlaceholder="Search units..."
      emptyMessage="No matching units."
    />
  );
}

async function fetchAllUnits() {
  const units: OrgUnitRecord[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(`${apiBase}/v1/org-units?page=${page}&limit=200`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as {
      data?: OrgUnitRecord[];
      pagination?: { hasMore?: boolean };
      message?: string;
      error?: string;
    };
    if (!response.ok) throw new Error(getErrorMessage(payload, "Failed to load org units."));
    units.push(...(payload.data ?? []));
    if (!payload.pagination?.hasMore) return units;
    page += 1;
  }
}
