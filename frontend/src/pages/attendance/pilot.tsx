import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { OrgUnitRecord } from "@/types/domain";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

type Envelope<T> = { data?: T; message?: string; error?: string };
type Device = {
  id: string;
  code: string;
  name: string;
  deviceType: string;
  status: string;
  orgUnitId: string | null;
};
type ShiftType = {
  id: string;
  code: string;
  name: string;
  category: string;
  earlyInMinutes: number;
  lateOutMinutes: number;
  graceLateMinutes: number;
  breakMinutes: number;
};
type PilotSetup = {
  wardUnitId: string;
  officeUnitId: string;
  fingerprintDeviceId: string;
  qrDeviceId: string;
  ward: { name: string; code: string };
  office: { name: string; code: string } | null;
  fingerprintDevice: { name: string; code: string };
  qrDevice: { name: string; code: string } | null;
  trainingSignedAt: string | null;
  tuningConfirmedAt: string | null;
};
type PilotForm = {
  wardUnitId: string;
  officeUnitId: string;
  fingerprintDeviceId: string;
  qrDeviceId: string;
  trainingCompleted: boolean;
  tuningConfirmed: boolean;
};

const flattenUnits = (units: OrgUnitRecord[]): OrgUnitRecord[] =>
  units.flatMap((unit) => [unit, ...flattenUnits(unit.children ?? [])]);

const formatDate = (value: string | null) => value
  ? new Date(value).toLocaleString()
  : "Not signed off";

export const AttendancePilotPage = () => {
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [shifts, setShifts] = useState<ShiftType[]>([]);
  const [setup, setSetup] = useState<PilotSetup | null>(null);
  const [form, setForm] = useState<PilotForm>({
    wardUnitId: "",
    officeUnitId: "",
    fingerprintDeviceId: "",
    qrDeviceId: "",
    trainingCompleted: false,
    tuningConfirmed: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingShift, setSavingShift] = useState<string | null>(null);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const result = await response.json() as Envelope<T>;
    if (!response.ok) {
      throw new Error(result.message || result.error || "Unable to load attendance pilot data.");
    }
    return result;
  }, []);

  const load = useCallback(async () => {
    const [unitResult, deviceResult, shiftResult, setupResult] = await Promise.all([
      request<OrgUnitRecord[]>("org-units/tree"),
      request<Device[]>("devices"),
      request<ShiftType[]>("shift-types?limit=200"),
      request<PilotSetup | null>("attendance/pilot"),
    ]);
    setUnits(unitResult.data ?? []);
    setDevices(deviceResult.data ?? []);
    setShifts(shiftResult.data ?? []);
    const currentSetup = setupResult.data ?? null;
    setSetup(currentSetup);
    setForm({
      wardUnitId: currentSetup?.wardUnitId ?? "",
      officeUnitId: currentSetup?.officeUnitId ?? "",
      fingerprintDeviceId: currentSetup?.fingerprintDeviceId ?? "",
      qrDeviceId: currentSetup?.qrDeviceId ?? "",
      trainingCompleted: Boolean(currentSetup?.trainingSignedAt),
      tuningConfirmed: Boolean(currentSetup?.tuningConfirmedAt),
    });
  }, [request]);

  useEffect(() => {
    void load().catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Unable to load the attendance pilot."),
    ).finally(() => setLoading(false));
  }, [load]);

  const allUnits = useMemo(() => flattenUnits(units), [units]);
  const wardOptions = useMemo(() => allUnits
    .filter((unit) => unit.unitType === "WARD")
    .map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })), [allUnits]);
  const officeOptions = useMemo(() => allUnits
    .filter((unit) => !unit.isClinical)
    .map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })), [allUnits]);
  const fingerprintOptions = useMemo(() => devices
    .filter((device) => device.status === "ACTIVE" && device.deviceType === "FINGERPRINT_TERMINAL")
    .map((device) => ({ value: device.id, label: `${device.name} · ${device.code}` })), [devices]);
  const qrOptions = useMemo(() => devices
    .filter((device) => device.status === "ACTIVE" && device.deviceType === "QR_SCANNER")
    .map((device) => ({ value: device.id, label: `${device.name} · ${device.code}` })), [devices]);

  const saveSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !form.wardUnitId || !form.officeUnitId ||
      !form.fingerprintDeviceId || !form.qrDeviceId
    ) {
      toast.error("Choose the pilot ward, office, fingerprint terminal and QR scanner.");
      return;
    }
    setSaving(true);
    try {
      const result = await request<PilotSetup>("attendance/pilot", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      if (!result.data) throw new Error("The attendance pilot setup was not returned.");
      setSetup(result.data);
      setForm((current) => ({
        ...current,
        trainingCompleted: Boolean(result.data?.trainingSignedAt),
        tuningConfirmed: Boolean(result.data?.tuningConfirmedAt),
      }));
      toast.success("Release 1 attendance pilot readiness saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the pilot setup.");
    } finally {
      setSaving(false);
    }
  };

  const saveShift = async (shift: ShiftType) => {
    setSavingShift(shift.id);
    try {
      await request<ShiftType>(`shift-types/${shift.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          earlyInMinutes: shift.earlyInMinutes,
          lateOutMinutes: shift.lateOutMinutes,
          graceLateMinutes: shift.graceLateMinutes,
          breakMinutes: shift.breakMinutes,
        }),
      });
      toast.success(`${shift.name} attendance windows saved.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to save ${shift.name}.`);
    } finally {
      setSavingShift(null);
    }
  };

  const trainingComplete = Boolean(setup?.trainingSignedAt);
  const shiftWindowsReviewed = Boolean(setup?.tuningConfirmedAt);
  const hardwareConfigured = Boolean(
    setup?.ward && setup.office && setup.fingerprintDevice && setup.qrDevice,
  );
  const ready = hardwareConfigured && trainingComplete && shiftWindowsReviewed;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Release 1 attendance pilot</h1>
        <p className="text-sm text-muted-foreground">Pair the pilot ward and admin office with their devices, confirm staff training and record attendance-window tuning.</p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Pilot readiness</CardTitle>
          <Badge variant={ready ? "default" : "secondary"}>{ready ? "Ready for go-live" : "Setup required"}</Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? <p className="text-sm text-muted-foreground">Loading pilot configuration...</p> : null}
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void saveSetup(event)}>
            <div className="space-y-1.5">
              <Label>Pilot ward</Label>
              <SearchableSelect
                value={form.wardUnitId}
                onValueChange={(wardUnitId) => setForm((current) => ({ ...current, wardUnitId }))}
                options={wardOptions}
                placeholder="Select ward"
                searchPlaceholder="Search wards..."
                emptyMessage="No ward units found."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Admin office</Label>
              <SearchableSelect
                value={form.officeUnitId}
                onValueChange={(officeUnitId) => setForm((current) => ({ ...current, officeUnitId }))}
                options={officeOptions}
                placeholder="Select non-clinical office"
                searchPlaceholder="Search units and offices..."
                emptyMessage="No non-clinical units found."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fingerprint terminal assigned to the ward</Label>
              <SearchableSelect
                value={form.fingerprintDeviceId}
                onValueChange={(fingerprintDeviceId) => setForm((current) => ({ ...current, fingerprintDeviceId }))}
                options={fingerprintOptions}
                placeholder="Select active fingerprint terminal"
                searchPlaceholder="Search fingerprint terminals..."
                emptyMessage="Register and assign an active fingerprint terminal first."
              />
            </div>
            <div className="space-y-1.5">
              <Label>QR scanner assigned to the office</Label>
              <SearchableSelect
                value={form.qrDeviceId}
                onValueChange={(qrDeviceId) => setForm((current) => ({ ...current, qrDeviceId }))}
                options={qrOptions}
                placeholder="Select active QR scanner"
                searchPlaceholder="Search QR scanners..."
                emptyMessage="Register and assign an active QR scanner first."
              />
            </div>
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={form.trainingCompleted}
                onChange={(event) => setForm((current) => ({ ...current, trainingCompleted: event.target.checked }))}
                className="mt-1"
              />
              <span><span className="font-medium">Staff trained</span><br />Confirm that pilot ward and office staff were trained on clock-in/out, offline handling and exception escalation.</span>
            </label>
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={form.tuningConfirmed}
                onChange={(event) => setForm((current) => ({ ...current, tuningConfirmed: event.target.checked }))}
                className="mt-1"
              />
              <span><span className="font-medium">Grace and early/late windows reviewed</span><br />Review the shift windows below with HR and the pilot unit managers before sign-off.</span>
            </label>
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving || loading}>
                {saving ? "Saving..." : "Save pilot readiness"}
              </Button>
            </div>
          </form>

          <div className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
            <p><span className="font-medium">Training sign-off:</span> {formatDate(setup?.trainingSignedAt ?? null)}</p>
            <p><span className="font-medium">Window review:</span> {formatDate(setup?.tuningConfirmedAt ?? null)}</p>
            {setup ? <>
              <p><span className="font-medium">Ward:</span> {setup.ward.name} · {setup.ward.code} — {setup.fingerprintDevice.name}</p>
              <p><span className="font-medium">Office:</span> {setup.office?.name ?? "Not configured"} — {setup.qrDevice?.name ?? "No QR scanner"}</p>
            </> : <p className="text-muted-foreground sm:col-span-2">Configure equipment and training sign-off to open the Release 1 pilot.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shift attendance windows</CardTitle>
          <p className="text-sm text-muted-foreground">Tune the early clock-in allowance, late grace and auto-close grace by shift type.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {shifts.length === 0 ? <p className="text-sm text-muted-foreground">No shift types are configured.</p> : shifts.map((shift) => (
            <div key={shift.id} className="grid gap-3 rounded-md border p-4 md:grid-cols-[minmax(9rem,1.2fr_repeat(4,minmax(7rem,1fr)))_auto] md:items-end">
              <div><p className="font-medium">{shift.name}</p><p className="text-sm text-muted-foreground">{shift.code} · {shift.category}</p></div>
              <div className="space-y-1.5"><Label>Early in (min)</Label><Input type="number" min={0} value={shift.earlyInMinutes} onChange={(event) => setShifts((rows) => rows.map((row) => row.id === shift.id ? { ...row, earlyInMinutes: Number(event.target.value) } : row))} /></div>
              <div className="space-y-1.5"><Label>Late grace (min)</Label><Input type="number" min={0} value={shift.graceLateMinutes} onChange={(event) => setShifts((rows) => rows.map((row) => row.id === shift.id ? { ...row, graceLateMinutes: Number(event.target.value) } : row))} /></div>
              <div className="space-y-1.5"><Label>Late out (min)</Label><Input type="number" min={0} value={shift.lateOutMinutes} onChange={(event) => setShifts((rows) => rows.map((row) => row.id === shift.id ? { ...row, lateOutMinutes: Number(event.target.value) } : row))} /></div>
              <div className="space-y-1.5"><Label>Break (min)</Label><Input type="number" min={0} value={shift.breakMinutes} onChange={(event) => setShifts((rows) => rows.map((row) => row.id === shift.id ? { ...row, breakMinutes: Number(event.target.value) } : row))} /></div>
              <Button variant="outline" onClick={() => void saveShift(shift)} disabled={savingShift === shift.id}>
                {savingShift === shift.id ? "Saving..." : "Save"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
