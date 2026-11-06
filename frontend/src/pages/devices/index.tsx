import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { OrgUnitRecord } from "@/types/domain";

type DeviceType =
  | "FINGERPRINT_TERMINAL"
  | "QR_SCANNER"
  | "BARCODE_SCANNER"
  | "KIOSK";
type AttendanceDevice = {
  id: string;
  code: string;
  name: string;
  deviceType: DeviceType;
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  orgUnitId: string | null;
  status: "ACTIVE" | "DISABLED";
  lastSeenAt: string | null;
  lastClockSkewSeconds: number | null;
};
type ApiEnvelope<T> = {
  data?: T;
  message?: string;
  error?: string;
  code?: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const deviceTypes: Array<{ value: DeviceType; label: string }> = [
  { value: "FINGERPRINT_TERMINAL", label: "Fingerprint terminal" },
  { value: "QR_SCANNER", label: "QR scanner" },
  { value: "BARCODE_SCANNER", label: "Barcode scanner" },
  { value: "KIOSK", label: "Kiosk" },
];

const flattenUnits = (units: OrgUnitRecord[]): OrgUnitRecord[] =>
  units.flatMap((unit) => [unit, ...flattenUnits(unit.children ?? [])]);

const isOnline = (seenAt: string | null) =>
  Boolean(seenAt && Date.now() - new Date(seenAt).getTime() <= 15 * 60_000);

export const DevicesPage = () => {
  const [devices, setDevices] = useState<AttendanceDevice[]>([]);
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [visibleKey, setVisibleKey] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    deviceType: "FINGERPRINT_TERMINAL" as DeviceType,
    vendor: "",
    model: "",
    serialNumber: "",
    orgUnitId: "",
  });
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok) {
      throw new Error(
        payload.message || payload.error || "The attendance request failed.",
      );
    }
    return payload;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceResult, unitResult] = await Promise.all([
        request<AttendanceDevice[]>("devices"),
        request<OrgUnitRecord[]>("org-units/tree"),
      ]);
      setDevices(deviceResult.data ?? []);
      setUnits(unitResult.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load().catch((error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load attendance devices.",
      );
    });
  }, [load]);

  const unitOptions = useMemo(
    () =>
      flattenUnits(units).map((unit) => ({
        value: unit.id,
        label: unit.name,
        keywords: unit.code,
      })),
    [units],
  );
  const activeCount = devices.filter(
    (device) => device.status === "ACTIVE",
  ).length;
  const onlineCount = devices.filter(
    (device) => device.status === "ACTIVE" && isOnline(device.lastSeenAt),
  ).length;
  const skewCount = devices.filter(
    (device) =>
      device.status === "ACTIVE" &&
      device.lastClockSkewSeconds !== null &&
      Math.abs(device.lastClockSkewSeconds) > 300,
  ).length;

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Device code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const result = await request<AttendanceDevice & { apiKey: string }>(
        "devices",
        {
          method: "POST",
          body: JSON.stringify({
            ...form,
            code: form.code.trim(),
            name: form.name.trim(),
            vendor: form.vendor.trim() || null,
            model: form.model.trim() || null,
            serialNumber: form.serialNumber.trim() || null,
            orgUnitId: form.orgUnitId || null,
          }),
        },
      );
      if (!result.data?.apiKey)
        throw new Error("The new device key was not returned.");
      setVisibleKey(result.data.apiKey);
      setForm({
        code: "",
        name: "",
        deviceType: "FINGERPRINT_TERMINAL",
        vendor: "",
        model: "",
        serialNumber: "",
        orgUnitId: "",
      });
      await load();
      toast.success("Attendance device registered.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to register the device.",
      );
    } finally {
      setSaving(false);
    }
  };

  const rotateKey = async (device: AttendanceDevice) => {
    try {
      const result = await request<{ apiKey: string }>(
        `devices/${device.id}/rotate-key`,
        {
          method: "POST",
        },
      );
      if (!result.data?.apiKey)
        throw new Error("The new device key was not returned.");
      setVisibleKey(result.data.apiKey);
      toast.success(`Key rotated for ${device.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to rotate the device key.",
      );
    }
  };

  const disable = async (device: AttendanceDevice) => {
    try {
      setDisabling(true);
      await request(`devices/${device.id}/disable`, { method: "POST" });
      toast.success(`${device.name} disabled.`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to disable the device.",
      );
    } finally {
      setDisabling(false);
    }
  };

  const enable = async (device: AttendanceDevice) => {
    try {
      setEnabling(true);
      await request(`devices/${device.id}/enable`, { method: "POST" });
      toast.success(`${device.name} enabled.`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to enable the device.",
      );
    } finally {
      setEnabling(false);
    }
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(visibleKey);
      toast.success("Device key copied.");
    } catch {
      toast.error(
        "Could not copy the device key. Select and copy it manually.",
      );
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Attendance devices</h1>
        <p className="text-sm text-muted-foreground">
          Register terminals and scanners, rotate device keys, and monitor
          connectivity.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active devices</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {activeCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Seen in the last 15 minutes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {onlineCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Clock skew over 5 minutes</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {skewCount}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register a device</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={register}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div className="space-y-2">
              <Label htmlFor="device-code">Device code</Label>
              <Input
                id="device-code"
                value={form.code}
                maxLength={30}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-name">Device name</Label>
              <Input
                id="device-name"
                value={form.name}
                maxLength={100}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-type">Device type</Label>
              <select
                id="device-type"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.deviceType}
                onChange={(event) =>
                  setForm({
                    ...form,
                    deviceType: event.target.value as DeviceType,
                  })
                }
              >
                {deviceTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <SearchableSelect
                options={unitOptions}
                value={form.orgUnitId}
                onValueChange={(orgUnitId) => setForm({ ...form, orgUnitId })}
                placeholder="Select a location"
                searchPlaceholder="Search units and wards..."
                emptyMessage="No matching locations."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-vendor">Vendor</Label>
              <Input
                id="device-vendor"
                value={form.vendor}
                maxLength={50}
                onChange={(event) =>
                  setForm({ ...form, vendor: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-model">Model</Label>
              <Input
                id="device-model"
                value={form.model}
                maxLength={50}
                onChange={(event) =>
                  setForm({ ...form, model: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="device-serial">Serial number</Label>
              <Input
                id="device-serial"
                value={form.serialNumber}
                maxLength={80}
                onChange={(event) =>
                  setForm({ ...form, serialNumber: event.target.value })
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={saving}
                className="cursor-pointer"
              >
                {saving ? "Registering..." : "Register device"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Device health</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading devices...</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attendance devices have been registered.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-left text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="p-3 font-medium">Device</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium">Health</th>
                    <th className="p-3 font-medium">Last seen</th>
                    <th className="p-3 font-medium">Clock skew</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{device.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {device.code}
                          {device.vendor ? ` · ${device.vendor}` : ""}
                        </div>
                      </td>
                      <td className="p-3">
                        {deviceTypes.find(
                          (type) => type.value === device.deviceType,
                        )?.label ?? device.deviceType}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={
                            device.status === "ACTIVE" &&
                            isOnline(device.lastSeenAt)
                              ? "default"
                              : "outline"
                          }
                        >
                          {device.status === "DISABLED"
                            ? "Disabled"
                            : isOnline(device.lastSeenAt)
                            ? "Online"
                            : "Offline"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        {device.lastSeenAt
                          ? new Date(device.lastSeenAt).toLocaleString()
                          : "Never"}
                      </td>
                      <td className="p-3">
                        {device.lastClockSkewSeconds === null
                          ? "—"
                          : `${device.lastClockSkewSeconds > 0 ? "+" : ""}${
                              device.lastClockSkewSeconds
                            }s`}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={device.status !== "ACTIVE"}
                            onClick={() => rotateKey(device)}
                            className="cursor-pointer"
                          >
                            Rotate key
                          </Button>
                          <Button
                            variant={
                              device.status === "DISABLED"
                                ? "default"
                                : "destructive"
                            }
                            size="sm"
                            onClick={() =>
                              device.status === "DISABLED"
                                ? enable(device)
                                : disable(device)
                            }
                            className="cursor-pointer"
                          >
                            {device.status === "DISABLED"
                              ? enabling
                                ? "Enabling..."
                                : "Enable"
                              : disabling
                              ? "Disabling..."
                              : "Disable"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(visibleKey)}
        onOpenChange={(open) => {
          if (!open) setVisibleKey("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy the device key</DialogTitle>
            <DialogDescription>
              This key is shown once. Save it in the device’s secure
              configuration before closing.
            </DialogDescription>
          </DialogHeader>
          <Input aria-label="Device key" readOnly value={visibleKey} />
          <Button type="button" onClick={copyKey} className="cursor-pointer">
            Copy key
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};
