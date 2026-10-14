import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { useShow, useNotification } from "@refinedev/core";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { StaffLicenseRecord, StaffRecord } from "@/types/domain";
import { licensingBodyOptions } from "@/constants/options";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

type NewLicense = {
  licensingBody: StaffLicenseRecord["licensingBody"];
  licenceNo: string;
  issuedOn: string;
  expiresOn: string;
  status: StaffLicenseRecord["status"];
};

export const StaffShow = () => {
  const { id } = useParams();
  const staffId = id ?? "";
  const { result: record } = useShow<StaffRecord>({});
  const { open: notify } = useNotification();
  const [licenses, setLicenses] = useState<StaffLicenseRecord[]>([]);
  const [savingLicense, setSavingLicense] = useState(false);
  const [newLicense, setNewLicense] = useState<NewLicense>({
    licensingBody: "MDC",
    licenceNo: "",
    issuedOn: "",
    expiresOn: "",
    status: "ACTIVE",
  });

  const initials = `${record?.firstName?.[0] ?? ""}${record?.lastName?.[0] ?? ""}`
    .trim()
    .toUpperCase() || "S";

  const loadLicenses = async () => {
    if (!staffId) return;
    const response = await fetch(`${apiBase}/v1/staff/${staffId}/licenses`, {
      credentials: "include",
      headers: createAuthHeaders(),
    });
    const payload = (await response.json()) as { data?: StaffLicenseRecord[]; message?: string };
    if (!response.ok) {
      throw new Error(payload.message || "Failed to load staff licenses.");
    }
    setLicenses(payload.data ?? []);
  };

  useEffect(() => {
    loadLicenses().catch((error) => {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to load licenses." });
    });
  }, [notify, staffId]);

  const createLicense = async () => {
    if (!staffId) return;
    if (!newLicense.licenceNo.trim() || !newLicense.expiresOn) {
      notify?.({ type: "error", message: "License number and expiry date are required." });
      return;
    }

    try {
      setSavingLicense(true);
      const response = await fetch(`${apiBase}/v1/staff/${staffId}/licenses`, {
        method: "POST",
        credentials: "include",
        headers: createAuthHeaders(),
        body: JSON.stringify({
          ...newLicense,
          licenceNo: newLicense.licenceNo.trim(),
          issuedOn: newLicense.issuedOn || undefined,
        }),
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "Failed to save license.");
      }
      notify?.({ type: "success", message: "License saved." });
      setNewLicense({
        licensingBody: "MDC",
        licenceNo: "",
        issuedOn: "",
        expiresOn: "",
        status: "ACTIVE",
      });
      await loadLicenses();
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to save license." });
    } finally {
      setSavingLicense(false);
    }
  };

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Staff Profile" />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 border">
              <AvatarImage src={record?.imageUrl ?? ""} alt={`${record?.firstName ?? ""} ${record?.lastName ?? ""}`.trim()} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <CardTitle>
              {record?.firstName} {record?.lastName}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DataItem label="Employee ID" value={record?.employeeId} />
          <DataItem label="Email" value={record?.email} />
          <DataItem label="Org Unit ID" value={record?.orgUnitId ?? undefined} />
          <DataItem label="Department" value={record?.department} />
          <DataItem label="Position" value={record?.position} />
          <DataItem label="Phone" value={record?.phone} />
          <DataItem label="Staff Category" value={record?.staffCategory} />
          <DataItem label="Schedule Mode" value={record?.scheduleMode} />
          <DataItem label="Job Role ID" value={record?.jobRoleId ?? undefined} />
          <DataItem label="Default Shift ID" value={record?.defaultShiftTypeId ?? undefined} />
          <DataItem label="Badge Number" value={record?.badgeNumber ?? undefined} />
          <DataItem label="MoMo Number" value={record?.momoNumber} />
          <DataItem label="MoMo Name" value={record?.momoName} />
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <Badge>{record?.status || "-"}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Professional Licences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Body</Label>
              <Select
                value={newLicense.licensingBody}
                onValueChange={(value) =>
                  setNewLicense((current) => ({ ...current, licensingBody: value as NewLicense["licensingBody"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {licensingBodyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Licence No</Label>
              <Input
                value={newLicense.licenceNo}
                onChange={(event) =>
                  setNewLicense((current) => ({ ...current, licenceNo: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Issued On</Label>
              <Input
                type="date"
                value={newLicense.issuedOn}
                onChange={(event) =>
                  setNewLicense((current) => ({ ...current, issuedOn: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Expires On</Label>
              <Input
                type="date"
                value={newLicense.expiresOn}
                onChange={(event) =>
                  setNewLicense((current) => ({ ...current, expiresOn: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={newLicense.status}
                onValueChange={(value) =>
                  setNewLicense((current) => ({ ...current, status: value as NewLicense["status"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["ACTIVE", "EXPIRED", "SUSPENDED", "REVOKED"].map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={createLicense} disabled={savingLicense}>
            {savingLicense ? "Saving..." : "Add License"}
          </Button>

          <div className="space-y-2">
            {licenses.length === 0 ? (
              <p className="text-sm text-muted-foreground">No licenses recorded.</p>
            ) : (
              licenses.map((license) => (
                <div key={license.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="font-medium">
                    {license.licensingBody} — {license.licenceNo}
                  </div>
                  <div className="text-muted-foreground">
                    Expires {license.expiresOn} · Status {license.status}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </ShowView>
  );
};

function DataItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}
