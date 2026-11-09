import { useCallback, useEffect, useMemo, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { OrgUnitRecord, StaffRecord } from "@/types/domain";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const monthStart = () => `${today().slice(0, 7)}-01`;
const currentMonth = () => today().slice(0, 7);
const localInput = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const localDateTimeToIso = (value: string) => new Date(value).toISOString();
const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`.trim();
const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString()
  : "—";
const formatMinutes = (value: number | null) => {
  const minutes = value ?? 0;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

type Envelope<T> = { data?: T; message?: string; error?: string };
type AttendanceRecord = {
  attendanceRecordId: string;
  staffId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  attendanceDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  status: string;
  source: string;
  workedMinutes: number | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  unitName: string | null;
  shiftName: string | null;
};
type AttendanceException = {
  exceptionId: string;
  staffId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  attendanceDate: string;
  exceptionType: string;
  status: string;
  note: string | null;
  unitName: string | null;
};
type Correction = {
  correctionId: string;
  attendanceDate: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  oldClockIn: string;
  oldClockOut: string;
  newClockIn: string;
  newClockOut: string;
  reason: string;
  requestedAt: string;
  status: string;
  decisionReason: string | null;
};
type ManualRequest = {
  requestId: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  punchedAt: string;
  direction: "IN" | "OUT";
  reason: string;
  requestedAt: string;
  status: string;
  decisionReason: string | null;
};
type SummaryRow = {
  employeeId: string;
  firstName: string;
  lastName: string;
  scheduled: number;
  worked: number;
  absent: number;
  late: number;
  lateMinutes: number;
  overtimeMinutes: number;
  night: number;
  weekend: number;
  holiday: number;
  workedMinutes: number;
};

const flattenUnits = (units: OrgUnitRecord[]): OrgUnitRecord[] =>
  units.flatMap((unit) => [unit, ...flattenUnits(unit.children ?? [])]);

const isHr = (roles: string[]) =>
  roles.some((role) => ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"].includes(role));

export const AttendanceOperationsPage = () => {
  const { data: identity } = useGetIdentity<{ role?: string; roles?: string[] }>();
  const roles = identity?.roles ?? (identity?.role ? [identity.role] : []);
  const canApprove = isHr(roles);
  const canManageAttendance = canApprove || roles.includes("UNIT_MANAGER");
  const [tab, setTab] = useState("log");
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [manualRequests, setManualRequests] = useState<ManualRequest[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffRecord[]>([]);
  const [units, setUnits] = useState<OrgUnitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(currentMonth());
  const [staffFilter, setStaffFilter] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [manualStaffId, setManualStaffId] = useState("");
  const [manualAt, setManualAt] = useState(() => localInput(new Date().toISOString()));
  const [manualDirection, setManualDirection] = useState<"IN" | "OUT">("IN");
  const [manualReason, setManualReason] = useState("");
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null);
  const [correctedIn, setCorrectedIn] = useState("");
  const [correctedOut, setCorrectedOut] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [busy, setBusy] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = await response.json() as Envelope<T>;
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "The attendance request failed.");
    }
    return payload;
  }, []);

  const loadStaffAndUnits = useCallback(async () => {
    const result = await request<{ staff: StaffRecord[]; units: OrgUnitRecord[] }>(
      "attendance/references",
    );
    setStaffOptions(result.data?.staff ?? []);
    setUnits(result.data?.units ?? []);
  }, [request]);

  const loadRecords = useCallback(async () => {
    const query = new URLSearchParams({ from, to });
    if (staffFilter) query.set("staffId", staffFilter);
    if (unitFilter) query.set("unitId", unitFilter);
    const result = await request<AttendanceRecord[]>(`attendance?${query.toString()}`);
    setRecords(result.data ?? []);
  }, [from, request, staffFilter, to, unitFilter]);

  const loadExceptions = useCallback(async () => {
    const query = new URLSearchParams({ status: "OPEN", from, to });
    if (unitFilter) query.set("unitId", unitFilter);
    const result = await request<AttendanceException[]>(`attendance/exceptions?${query.toString()}`);
    setExceptions(result.data ?? []);
  }, [from, request, to, unitFilter]);

  const loadCorrections = useCallback(async () => {
    const result = await request<Correction[]>("attendance/corrections?status=PENDING");
    setCorrections(result.data ?? []);
  }, [request]);

  const loadManualRequests = useCallback(async () => {
    const result = await request<ManualRequest[]>("attendance/manual-punch-requests?status=PENDING");
    setManualRequests(result.data ?? []);
  }, [request]);

  const loadSummary = useCallback(async () => {
    const query = new URLSearchParams({ month });
    if (unitFilter) query.set("unitId", unitFilter);
    const result = await request<SummaryRow[]>(`attendance/summary?${query.toString()}`);
    setSummary(result.data ?? []);
  }, [month, request, unitFilter]);

  const loadActiveTab = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "log") await loadRecords();
      if (tab === "exceptions") await loadExceptions();
      if (tab === "corrections") await loadCorrections();
      if (tab === "manual") await loadManualRequests();
      if (tab === "summary") await loadSummary();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load attendance data.");
    } finally {
      setLoading(false);
    }
  }, [loadCorrections, loadExceptions, loadManualRequests, loadRecords, loadSummary, tab]);

  useEffect(() => {
    void loadStaffAndUnits().catch((error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Unable to load workforce references."),
    );
  }, [loadStaffAndUnits]);

  useEffect(() => {
    void loadActiveTab();
  }, [loadActiveTab]);

  const employeeOptions = useMemo(() => staffOptions.map((person) => ({
    value: person.id,
    label: `${fullName(person)} · ${person.employeeId}`,
    keywords: `${person.employeeId} ${person.email ?? ""}`,
  })), [staffOptions]);
  const unitOptions = useMemo(() => flattenUnits(units).map((unit) => ({
    value: unit.id,
    label: `${unit.name} (${unit.code})`,
  })), [units]);

  const resolveException = async (exception: AttendanceException, action: "EXCUSE" | "CONFIRM") => {
    const reason = window.prompt(`${action === "EXCUSE" ? "Excuse" : "Confirm"} ${exception.exceptionType}. Enter a reason.`);
    if (!reason?.trim()) return;
    try {
      await request(`attendance/exceptions/${exception.exceptionId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      toast.success("Attendance exception resolved.");
      await loadExceptions();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to resolve the exception.");
    }
  };

  const openCorrection = (record: AttendanceRecord) => {
    setCorrectionRecord(record);
    setCorrectedIn(localInput(record.clockInAt));
    setCorrectedOut(localInput(record.clockOutAt));
    setCorrectionReason("");
  };

  const submitCorrection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!correctionRecord || !correctedIn || !correctedOut || correctionReason.trim().length < 5) {
      toast.error("Enter both corrected times and a reason of at least five characters.");
      return;
    }
    setBusy(true);
    try {
      await request(`attendance/${correctionRecord.attendanceRecordId}/corrections`, {
        method: "POST",
        body: JSON.stringify({
          newClockIn: localDateTimeToIso(correctedIn),
          newClockOut: localDateTimeToIso(correctedOut),
          reason: correctionReason.trim(),
        }),
      });
      toast.success("Correction request submitted for HR approval.");
      setCorrectionRecord(null);
      await loadRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit the correction.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    endpoint: string,
    title: string,
    decision: "APPROVE" | "REJECT",
  ) => {
    const reason = window.prompt(`${decision === "APPROVE" ? "Approve" : "Reject"} ${title}: enter a decision reason.`);
    if (!reason?.trim()) return;
    try {
      await request(endpoint, {
        method: "POST",
        body: JSON.stringify({ decision, reason: reason.trim() }),
      });
      toast.success(`${title} ${decision === "APPROVE" ? "approved" : "rejected"}.`);
      await Promise.all([loadCorrections(), loadManualRequests()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to approve ${title.toLowerCase()}.`);
    }
  };

  const submitManualPunch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!manualStaffId || !manualAt || manualReason.trim().length < 5) {
      toast.error("Choose an employee, time, direction, and a reason of at least five characters.");
      return;
    }
    setBusy(true);
    try {
      await request("attendance/manual-punch", {
        method: "POST",
        body: JSON.stringify({
          staffId: manualStaffId,
          punchedAt: localDateTimeToIso(manualAt),
          direction: manualDirection,
          reason: manualReason.trim(),
        }),
      });
      setManualReason("");
      toast.success("Manual punch submitted for independent approval.");
      await loadManualRequests();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit the manual punch.");
    } finally {
      setBusy(false);
    }
  };

  const resolveManual = async (requestRow: ManualRequest) => {
    await decide(
      `attendance/manual-punch-requests/${requestRow.requestId}/decision`,
      `Manual ${requestRow.direction} for ${fullName(requestRow)}`,
      "APPROVE",
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Attendance operations</h1>
        <p className="text-sm text-muted-foreground">Review punches, resolve exceptions, approve corrections and export monthly workforce totals.</p>
      </div>
      <Card>
        <CardContent className="grid gap-3 pt-5 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>To</Label>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Employee</Label>
            <SearchableSelect
              value={staffFilter}
              onValueChange={setStaffFilter}
              options={employeeOptions}
              placeholder="All employees"
              searchPlaceholder="Search employee or employee ID..."
              emptyMessage="No employees found."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <SearchableSelect
              value={unitFilter}
              onValueChange={setUnitFilter}
              options={unitOptions}
              placeholder="All units"
              searchPlaceholder="Search units..."
              emptyMessage="No units found."
            />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="log">Attendance log</TabsTrigger>
          <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
          <TabsTrigger value="corrections">Correction requests</TabsTrigger>
          <TabsTrigger value="manual">Manual punch approval</TabsTrigger>
          <TabsTrigger value="summary">Monthly summary</TabsTrigger>
        </TabsList>

        <TabsContent value="log">
          <Card>
            <CardHeader><CardTitle>Attendance log</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-sm text-muted-foreground">Loading attendance...</p> : records.length === 0
                ? <p className="text-sm text-muted-foreground">No attendance records match these filters.</p>
                : <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Date</TableHead>
                    <TableHead>Shift / unit</TableHead><TableHead>Clock in</TableHead><TableHead>Clock out</TableHead>
                    <TableHead>Status</TableHead><TableHead>Worked</TableHead><TableHead>Late</TableHead>
                    <TableHead>Overtime</TableHead><TableHead />
                  </TableRow></TableHeader>
                  <TableBody>{records.map((record) => (
                    <TableRow key={record.attendanceRecordId}>
                      <TableCell>{fullName(record)}</TableCell>
                      <TableCell>{record.employeeId}</TableCell>
                      <TableCell>{record.attendanceDate}</TableCell>
                      <TableCell>{[record.shiftName, record.unitName].filter(Boolean).join(" · ") || "Unrostered"}</TableCell>
                      <TableCell>{formatTime(record.clockInAt)}</TableCell>
                      <TableCell>{formatTime(record.clockOutAt)}</TableCell>
                      <TableCell><Badge variant={record.status === "OPEN" ? "secondary" : "default"}>{record.status}</Badge></TableCell>
                      <TableCell>{formatMinutes(record.workedMinutes)}</TableCell>
                      <TableCell>{record.lateMinutes ? formatMinutes(record.lateMinutes) : "—"}</TableCell>
                      <TableCell>{record.overtimeMinutes ? formatMinutes(record.overtimeMinutes) : "—"}</TableCell>
                      <TableCell>
                        {canManageAttendance && record.clockOutAt && ["CLOSED", "AUTO_CLOSED"].includes(record.status)
                          ? <Button variant="outline" size="sm" onClick={() => openCorrection(record)}>Request correction</Button>
                          : null}
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions">
          <Card>
            <CardHeader><CardTitle>Open attendance exceptions</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-sm text-muted-foreground">Loading exceptions...</p> : exceptions.length === 0
                ? <p className="text-sm text-muted-foreground">There are no open exceptions in this period.</p>
                : <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Date</TableHead>
                    <TableHead>Exception</TableHead><TableHead>Unit</TableHead><TableHead>Details</TableHead>
                    {canManageAttendance ? <TableHead>Resolve</TableHead> : null}
                  </TableRow></TableHeader>
                  <TableBody>{exceptions.map((exception) => (
                    <TableRow key={exception.exceptionId}>
                      <TableCell>{fullName(exception)}</TableCell><TableCell>{exception.employeeId}</TableCell>
                      <TableCell>{exception.attendanceDate}</TableCell>
                      <TableCell><Badge variant="secondary">{exception.exceptionType}</Badge></TableCell>
                      <TableCell>{exception.unitName ?? "—"}</TableCell><TableCell>{exception.note ?? "—"}</TableCell>
                      {canManageAttendance ? (
                        <TableCell className="space-x-2">
                          <Button size="sm" onClick={() => void resolveException(exception, "CONFIRM")}>Confirm</Button>
                          <Button size="sm" variant="outline" onClick={() => void resolveException(exception, "EXCUSE")}>Excuse</Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="corrections">
          <Card>
            <CardHeader><CardTitle>Pending correction requests</CardTitle></CardHeader>
            <CardContent>
              {loading ? <p className="text-sm text-muted-foreground">Loading correction requests...</p> : corrections.length === 0
                ? <p className="text-sm text-muted-foreground">No correction requests are awaiting review.</p>
                : <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Date</TableHead>
                    <TableHead>Clock times (old → requested)</TableHead><TableHead>Reason</TableHead><TableHead>Requested</TableHead>
                    {canApprove ? <TableHead /> : null}
                  </TableRow></TableHeader>
                  <TableBody>{corrections.map((correction) => (
                    <TableRow key={correction.correctionId}>
                      <TableCell>{`${correction.firstName ?? ""} ${correction.lastName ?? ""}`.trim()}</TableCell>
                      <TableCell>{correction.employeeId ?? "—"}</TableCell><TableCell>{correction.attendanceDate}</TableCell>
                      <TableCell>
                        {formatTime(correction.oldClockIn)} – {formatTime(correction.oldClockOut)}
                        <br />
                        {formatTime(correction.newClockIn)} – {formatTime(correction.newClockOut)}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">{correction.reason}</TableCell>
                      <TableCell>{formatTime(correction.requestedAt)}</TableCell>
                      {canApprove ? <TableCell>
                        <Button size="sm" onClick={() => void decide(
                          `attendance/corrections/${correction.correctionId}/decision`,
                          "attendance correction",
                          "APPROVE",
                        )}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void decide(
                          `attendance/corrections/${correction.correctionId}/decision`,
                          "attendance correction",
                          "REJECT",
                        )}>Reject</Button>
                      </TableCell> : null}
                    </TableRow>
                  ))}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Request a manual punch</CardTitle></CardHeader>
            <CardContent>
              {canManageAttendance ? (
              <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => void submitManualPunch(event)}>
                <div className="space-y-1.5">
                  <Label>Employee</Label>
                  <SearchableSelect
                    value={manualStaffId}
                    onValueChange={setManualStaffId}
                    options={employeeOptions}
                    placeholder="Select employee"
                    searchPlaceholder="Search employee or employee ID..."
                    emptyMessage="No employees found."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Direction</Label>
                  <Select value={manualDirection} onValueChange={(value) => setManualDirection(value as "IN" | "OUT")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="IN">Clock in</SelectItem><SelectItem value="OUT">Clock out</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Punch time</Label>
                  <Input type="datetime-local" value={manualAt} onChange={(event) => setManualAt(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input value={manualReason} onChange={(event) => setManualReason(event.target.value)} maxLength={1000} />
                </div>
                <div><Button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit for approval"}</Button></div>
              </form>
              ) : <p className="text-sm text-muted-foreground">Only HR and unit managers can submit manual punches.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Pending manual punches</CardTitle></CardHeader>
            <CardContent>
              {manualRequests.length === 0
                ? <p className="text-sm text-muted-foreground">No manual punches are awaiting approval.</p>
                : <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Direction</TableHead>
                    <TableHead>Time</TableHead><TableHead>Reason</TableHead>{canApprove ? <TableHead /> : null}
                  </TableRow></TableHeader>
                  <TableBody>{manualRequests.map((manual) => (
                    <TableRow key={manual.requestId}>
                      <TableCell>{fullName(manual)}</TableCell><TableCell>{manual.employeeId}</TableCell>
                      <TableCell>{manual.direction}</TableCell><TableCell>{formatTime(manual.punchedAt)}</TableCell>
                      <TableCell className="max-w-64 whitespace-normal">{manual.reason}</TableCell>
                      {canApprove ? <TableCell className="space-x-2">
                        <Button size="sm" onClick={() => void resolveManual(manual)}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => void decide(
                          `attendance/manual-punch-requests/${manual.requestId}/decision`,
                          "manual punch",
                          "REJECT",
                        )}>Reject</Button>
                      </TableCell> : null}
                    </TableRow>
                  ))}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>Monthly attendance summary</CardTitle>
              <div className="flex items-center gap-2">
                <Label htmlFor="attendance-month">Month</Label>
                <Input id="attendance-month" type="month" className="w-44" value={month} onChange={(event) => setMonth(event.target.value)} />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? <p className="text-sm text-muted-foreground">Loading summary...</p> : summary.length === 0
                ? <p className="text-sm text-muted-foreground">No roster or attendance activity was found for this month.</p>
                : <Table>
                  <TableHeader><TableRow>
                    <TableHead>Employee</TableHead><TableHead>Employee ID</TableHead><TableHead>Scheduled</TableHead>
                    <TableHead>Worked</TableHead><TableHead>Absent</TableHead><TableHead>Late shifts</TableHead>
                    <TableHead>Late time</TableHead><TableHead>Worked time</TableHead><TableHead>Overtime</TableHead>
                    <TableHead>Night</TableHead><TableHead>Weekend</TableHead><TableHead>Holiday</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{summary.map((row) => (
                    <TableRow key={row.employeeId}>
                      <TableCell>{fullName(row)}</TableCell><TableCell>{row.employeeId}</TableCell>
                      <TableCell>{row.scheduled}</TableCell><TableCell>{row.worked}</TableCell>
                      <TableCell>{row.absent}</TableCell><TableCell>{row.late}</TableCell>
                      <TableCell>{formatMinutes(row.lateMinutes)}</TableCell>
                      <TableCell>{formatMinutes(row.workedMinutes)}</TableCell>
                      <TableCell>{formatMinutes(row.overtimeMinutes)}</TableCell>
                      <TableCell>{row.night}</TableCell><TableCell>{row.weekend}</TableCell><TableCell>{row.holiday}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {correctionRecord ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="correction-title">
          <form className="w-full max-w-lg space-y-4 rounded-lg bg-background p-5 shadow-lg" onSubmit={(event) => void submitCorrection(event)}>
            <div>
              <h2 id="correction-title" className="text-lg font-semibold">Request attendance correction</h2>
              <p className="text-sm text-muted-foreground">{fullName(correctionRecord)} · Employee ID {correctionRecord.employeeId} · {correctionRecord.attendanceDate}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label>Correct clock in</Label><Input type="datetime-local" value={correctedIn} onChange={(event) => setCorrectedIn(event.target.value)} /></div>
              <div className="space-y-1.5"><Label>Correct clock out</Label><Input type="datetime-local" value={correctedOut} onChange={(event) => setCorrectedOut(event.target.value)} /></div>
            </div>
            <div className="space-y-1.5"><Label>Reason</Label><Input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} maxLength={1000} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCorrectionRecord(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit request"}</Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
};

export const MyAttendancePage = () => {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [newIn, setNewIn] = useState("");
  const [newOut, setNewOut] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const [attendanceResponse, correctionResponse] = await Promise.all([
      fetch(`${apiBase}/v1/me/attendance`, {
        credentials: "include",
        headers: createAuthHeaders(),
      }),
      fetch(`${apiBase}/v1/attendance/me/corrections`, {
        credentials: "include",
        headers: createAuthHeaders(),
      }),
    ]);
    const attendance = await attendanceResponse.json() as Envelope<AttendanceRecord[]>;
    const correctionResult = await correctionResponse.json() as Envelope<Correction[]>;
    if (!attendanceResponse.ok) throw new Error(attendance.message || "Unable to load your attendance.");
    if (!correctionResponse.ok) throw new Error(correctionResult.message || "Unable to load your correction requests.");
    setRecords(attendance.data ?? []);
    setCorrections(correctionResult.data ?? []);
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to load your attendance."))
      .finally(() => setLoading(false));
  }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRecord || !newIn || !newOut || reason.trim().length < 5) {
      toast.error("Enter both corrected times and a reason of at least five characters.");
      return;
    }
    try {
      const response = await fetch(`${apiBase}/v1/attendance/${selectedRecord.attendanceRecordId}/corrections`, {
        method: "POST",
        credentials: "include",
        headers: createAuthHeaders(),
        body: JSON.stringify({
          newClockIn: localDateTimeToIso(newIn),
          newClockOut: localDateTimeToIso(newOut),
          reason: reason.trim(),
        }),
      });
      const result = await response.json() as Envelope<unknown>;
      if (!response.ok) throw new Error(result.message || "Unable to submit the correction request.");
      setSelectedRecord(null);
      setReason("");
      toast.success("Correction request sent for HR approval.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to submit the correction request.");
    }
  };

  return (
    <div className="space-y-5">
      <div><h1 className="text-2xl font-semibold">My attendance</h1><p className="text-sm text-muted-foreground">Review your clock records and track correction requests.</p></div>
      <Card><CardHeader><CardTitle>My attendance history</CardTitle></CardHeader><CardContent>
        {loading ? <p className="text-sm text-muted-foreground">Loading your attendance...</p> : records.length === 0
          ? <p className="text-sm text-muted-foreground">No attendance records are available.</p>
          : <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Shift / unit</TableHead><TableHead>Clock in</TableHead><TableHead>Clock out</TableHead><TableHead>Status</TableHead><TableHead>Worked</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{records.map((record) => <TableRow key={record.attendanceRecordId}>
              <TableCell>{record.attendanceDate}</TableCell><TableCell>{[record.shiftName, record.unitName].filter(Boolean).join(" · ") || "Unrostered"}</TableCell>
              <TableCell>{formatTime(record.clockInAt)}</TableCell><TableCell>{formatTime(record.clockOutAt)}</TableCell>
              <TableCell>{record.status}</TableCell><TableCell>{formatMinutes(record.workedMinutes)}</TableCell>
              <TableCell>{record.clockOutAt && ["CLOSED", "AUTO_CLOSED"].includes(record.status) ? <Button variant="outline" size="sm" onClick={() => {
                setSelectedRecord(record);
                setNewIn(localInput(record.clockInAt));
                setNewOut(localInput(record.clockOutAt));
              }}>Request correction</Button> : null}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>My correction requests</CardTitle></CardHeader><CardContent>
        {corrections.length === 0 ? <p className="text-sm text-muted-foreground">You have no correction requests.</p>
          : <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Requested clock in</TableHead><TableHead>Requested clock out</TableHead><TableHead>Reason</TableHead><TableHead>Status</TableHead><TableHead>Decision note</TableHead></TableRow></TableHeader>
            <TableBody>{corrections.map((correction) => <TableRow key={correction.correctionId}>
              <TableCell>{correction.attendanceDate}</TableCell><TableCell>{formatTime(correction.newClockIn)}</TableCell>
              <TableCell>{formatTime(correction.newClockOut)}</TableCell><TableCell>{correction.reason}</TableCell>
              <TableCell>{correction.status}</TableCell><TableCell>{correction.decisionReason ?? "—"}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
      </CardContent></Card>
      {selectedRecord ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
        <form className="w-full max-w-lg space-y-4 rounded-lg bg-background p-5 shadow-lg" onSubmit={(event) => void submit(event)}>
          <h2 className="text-lg font-semibold">Request correction · {selectedRecord.attendanceDate}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Correct clock in</Label><Input type="datetime-local" value={newIn} onChange={(event) => setNewIn(event.target.value)} /></div>
            <div className="space-y-1.5"><Label>Correct clock out</Label><Input type="datetime-local" value={newOut} onChange={(event) => setNewOut(event.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Reason</Label><Input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} /></div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSelectedRecord(null)}>Cancel</Button><Button type="submit">Submit request</Button></div>
        </form>
      </div> : null}
    </div>
  );
};
