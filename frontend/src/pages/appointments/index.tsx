import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { useDebouncedValue } from "@/hooks/use-registry";
import { appointmentRequest } from "@/lib/appointments-api";
import { errorMessage, withQuery } from "@/lib/patients-api";
import type { PatientSummary } from "@/types/patients";

type References = {
  units: Array<{ id: string; code: string; name: string }>;
  providers: Array<{ id: string; employeeId: string; name: string }>;
  consultationServices: Array<{ id: string; code: string; name: string }>;
};
type AppointmentSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  remainingCapacity: number;
  status: string;
  available: boolean;
  providerName: string;
  providerEmployeeId: string | null;
  unitName: string;
};
type AppointmentRecord = {
  id: string;
  patientName: string;
  appointmentType?: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  reason?: string | null;
  unitName: string;
  providerName?: string;
  providerEmployeeId?: string | null;
};
type ClinicTemplate = {
  id: string;
  orgUnitId: string;
  providerStaffId: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  capacityPerSlot: number;
  overbookLimit: number;
  consultationServiceId: string | null;
  validFrom: string;
  validTo: string | null;
  active: boolean;
  unitName: string;
  providerName: string;
  providerEmployeeId: string | null;
  serviceName: string | null;
};
type RebookTask = {
  task: { id: string; createdAt: string };
  appointment: { id: string; scheduledStart: string; scheduledEnd: string; status: string };
  patientName: string;
  unitName: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekDays = (start: string) => Array.from({ length: 7 }, (_, index) => shiftDate(start, index));
const timeLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
const weekdayOptions = [
  { value: "1", label: "Monday" }, { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" }, { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" }, { value: "6", label: "Saturday" },
  { value: "7", label: "Sunday" },
];
const appointmentTypeOptions = [
  { value: "NEW", label: "New" }, { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "REVIEW", label: "Review" }, { value: "PROCEDURE", label: "Procedure" },
];

function AppointmentPatientSearch({
  value,
  onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (patient: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const query = useDebouncedValue(term.trim(), 300);

  useEffect(() => {
    if (!open || query.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setLoading(true);
    appointmentRequest<PatientSummary[]>(withQuery("patients", { q: query, limit: 15 }))
      .then(({ data }) => { if (active) setResults(data.filter((row) => !row.masked)); })
      .catch((error: unknown) => {
        if (active) {
          setResults([]);
          toast.error(errorMessage(error, "Patient search failed."));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, query]);

  return (
    <div className="relative">
      <Button type="button" variant="outline" className="w-full justify-start font-normal" onClick={() => setOpen((state) => !state)}>
        <UserRound aria-hidden="true" className="mr-2 size-4" />
        {value?.name ?? "Search patient by name"}
      </Button>
      {open ? (
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-popover p-2 shadow-lg">
          <Input autoFocus value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Type at least 2 characters" />
          <div className="max-h-56 overflow-y-auto py-1">
            {query.length < 2 ? <p className="p-2 text-sm text-muted-foreground">Type at least 2 characters.</p> : null}
            {loading ? <p className="p-2 text-sm text-muted-foreground">Searching…</p> : null}
            {!loading && query.length >= 2 && results.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No matching patients.</p> : null}
            {results.map((patient) => (
              <button
                type="button"
                key={patient.id}
                className="block w-full rounded-sm px-2 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onChange({ id: patient.id, name: patient.fullName });
                  setOpen(false);
                  setTerm("");
                }}
              >
                {patient.fullName}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
        </div>
      ) : null}
    </div>
  );
}

export function AppointmentsPage() {
  const [references, setReferences] = useState<References>({ units: [], providers: [], consultationServices: [] });
  const [templates, setTemplates] = useState<ClinicTemplate[]>([]);
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [rebookTasks, setRebookTasks] = useState<RebookTask[]>([]);
  const [weekStart, setWeekStart] = useState(today());
  const [selectedDate, setSelectedDate] = useState(today());
  const [unitId, setUnitId] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [patientChoice, setPatientChoice] = useState<{ id: string; name: string } | null>(null);
  const [appointmentType, setAppointmentType] = useState("NEW");
  const [bookedVia, setBookedVia] = useState("FRONT_DESK");
  const [reason, setReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [loadedScheduleKey, setLoadedScheduleKey] = useState("");
  const [rescheduleSlotIds, setRescheduleSlotIds] = useState<Record<string, string>>({});
  const [rescheduleSlots, setRescheduleSlots] = useState<AppointmentSlot[]>([]);
  const [rescheduleSlotsUnitId, setRescheduleSlotsUnitId] = useState("");
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const scheduleSelectionRef = useRef({ weekStart, unitId, statusFilter });
  scheduleSelectionRef.current = { weekStart, unitId, statusFilter };
  const referencesRef = useRef(references);
  referencesRef.current = references;
  const scheduleRequestId = useRef(0);
  const [templateForm, setTemplateForm] = useState({
    editingId: "",
    orgUnitId: "",
    providerStaffId: "",
    weekday: "1",
    startTime: "08:00",
    endTime: "12:00",
    slotMinutes: "20",
    capacityPerSlot: "1",
    overbookLimit: "0",
    consultationServiceId: "",
    validFrom: today(),
    validTo: "",
    active: true,
  });
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const unitOptions = useMemo<SearchableSelectOption[]>(() =>
    references.units.map((unit) => ({ value: unit.id, label: `${unit.name} · ${unit.code}` })), [references.units]);
  const providerOptions = useMemo<SearchableSelectOption[]>(() =>
    [{ value: "", label: "Pooled clinic (any rostered provider)" }, ...references.providers.map((provider) => ({
      value: provider.id,
      label: `${provider.name} · Employee ID: ${provider.employeeId}`,
      keywords: provider.employeeId,
    }))], [references.providers]);
  const serviceOptions = useMemo<SearchableSelectOption[]>(() =>
    [{ value: "", label: "No consultation service" }, ...references.consultationServices.map((service) => ({ value: service.id, label: `${service.name} · ${service.code}` }))], [references.consultationServices]);
  const currentScheduleKey = `${weekStart}|${unitId}|${statusFilter}`;
  const scheduleIsCurrent = Boolean(unitId) && !scheduleLoading && loadedScheduleKey === currentScheduleKey;
  const visibleSlots = scheduleIsCurrent ? slots : [];
  const visibleAppointments = scheduleIsCurrent ? appointments : [];
  const visibleRebookTasks = scheduleIsCurrent ? rebookTasks : [];
  const rescheduleSlotOptions = useMemo<SearchableSelectOption[]>(() =>
    (rescheduleSlotsUnitId === unitId ? rescheduleSlots : []).filter((slot) => slot.available).map((slot) => ({
      value: slot.id,
      label: `${dateLabel(slot.startsAt.slice(0, 10))} · ${timeLabel(slot.startsAt)}–${timeLabel(slot.endsAt)} · ${slot.providerName} · ${slot.capacity - slot.bookedCount} free`,
    })), [rescheduleSlots, rescheduleSlotsUnitId, unitId]);

  const loadReferences = async () => {
    const [referenceResult, templateResult] = await Promise.all([
      appointmentRequest<References>("appointment-references"),
      appointmentRequest<ClinicTemplate[]>("clinic-session-templates"),
    ]);
    setReferences(referenceResult.data);
    setTemplates(templateResult.data);
    setUnitId((current) => current || referenceResult.data.units[0]?.id || "");
    setTemplateForm((current) => ({
      ...current,
      orgUnitId: current.orgUnitId || referenceResult.data.units[0]?.id || "",
    }));
  };
  const loadSchedule = async () => {
    const selection = scheduleSelectionRef.current;
    const requestId = ++scheduleRequestId.current;
    const selectionKey = `${selection.weekStart}|${selection.unitId}|${selection.statusFilter}`;
    if (!selection.unitId) {
      setSlots([]);
      setAppointments([]);
      setRebookTasks([]);
      setLoadedScheduleKey("");
      setScheduleLoading(false);
      return;
    }

    setScheduleLoading(true);
    setLoadedScheduleKey("");
    setSlots([]);
    setAppointments([]);
    setRebookTasks([]);
    const isCurrent = () =>
      scheduleRequestId.current === requestId &&
      `${scheduleSelectionRef.current.weekStart}|${scheduleSelectionRef.current.unitId}|${scheduleSelectionRef.current.statusFilter}` === selectionKey;
    try {
      const from = new Date(`${selection.weekStart}T00:00:00.000Z`).toISOString();
      const to = new Date(`${shiftDate(selection.weekStart, 7)}T00:00:00.000Z`).toISOString();
      const appointmentsRequest = async () => {
        const allAppointments: AppointmentRecord[] = [];
        const limit = 200;
        for (let page = 1; ; page += 1) {
          const result = await appointmentRequest<AppointmentRecord[]>(withQuery("appointments", {
            from,
            to,
            unitId: selection.unitId,
            status: selection.statusFilter === "ALL" ? "" : selection.statusFilter,
            page,
            limit,
          }));
          allAppointments.push(...result.data);
          if (result.data.length < limit) return allAppointments;
        }
      };
      const tasksRequest = async () => {
        const allTasks: RebookTask[] = [];
        const limit = 200;
        for (let page = 1; ; page += 1) {
          const result = await appointmentRequest<RebookTask[]>(withQuery("appointment-rebook-tasks", {
            unitId: selection.unitId,
            page,
            limit,
          }));
          allTasks.push(...result.data);
          if (result.data.length < limit) return allTasks;
        }
      };
      const [slotResult, appointmentRows, taskRows] = await Promise.all([
        appointmentRequest<AppointmentSlot[]>(withQuery("appointment-slots", { unitId: selection.unitId, from, to })),
        appointmentsRequest(),
        tasksRequest(),
      ]);
      if (!isCurrent()) return;
      setSlots(slotResult.data);
      setAppointments(appointmentRows);
      const unitName = referencesRef.current.units.find((unit) => unit.id === selection.unitId)?.name;
      setRebookTasks(taskRows.filter((task) => task.unitName === unitName));
      setLoadedScheduleKey(selectionKey);
    } finally {
      if (requestId === scheduleRequestId.current) setScheduleLoading(false);
    }
  };

  useEffect(() => {
    loadReferences().catch((error: unknown) => toast.error(errorMessage(error, "Appointment references could not be loaded.")));
  }, []);

  useEffect(() => {
    if (!unitId) {
      setRescheduleSlots([]);
      setRescheduleSlotsUnitId("");
      setRescheduleSlotsLoading(false);
      return;
    }
    let active = true;
    setRescheduleSlotsUnitId("");
    setRescheduleSlotsLoading(true);
    setRescheduleSlotIds({});
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
    appointmentRequest<AppointmentSlot[]>(withQuery("appointment-slots", {
      unitId,
      from,
      to,
      available: true,
    }))
      .then(({ data }) => {
        if (active) {
          setRescheduleSlots(data);
          setRescheduleSlotsUnitId(unitId);
        }
      })
      .catch((error: unknown) => {
        if (active) toast.error(errorMessage(error, "Reschedule slots could not be loaded."));
      })
      .finally(() => { if (active) setRescheduleSlotsLoading(false); });
    return () => { active = false; };
  }, [unitId]);

  useEffect(() => {
    setSelectedDate(weekStart);
  }, [weekStart]);

  useEffect(() => {
    setSelectedSlotId("");
  }, [selectedDate, unitId]);

  useEffect(() => {
    loadSchedule().catch((error: unknown) => toast.error(errorMessage(error, "Appointments could not be loaded.")));
  }, [weekStart, unitId, statusFilter, references.units]);

  const refresh = async () => {
    await Promise.all([loadReferences(), loadSchedule()]);
  };

  const createAppointment = async () => {
    if (!scheduleIsCurrent) {
      toast.error("Wait for the selected clinic schedule to finish loading.");
      return;
    }
    if (!patientChoice || !selectedSlotId) {
      toast.error("Choose a patient and an available slot.");
      return;
    }
    setBusy(true);
    try {
      await appointmentRequest("appointments", {
        method: "POST",
        body: { patientId: patientChoice.id, slotId: selectedSlotId, appointmentType, bookedVia, reason: reason || null },
      });
      toast.success("Appointment booked.");
      setPatientChoice(null);
      setSelectedSlotId("");
      setReason("");
      await loadSchedule();
    } catch (error) {
      toast.error(errorMessage(error, "Appointment could not be booked."));
    } finally {
      setBusy(false);
    }
  };

  const cancelAppointment = async (record: AppointmentRecord) => {
    const cancellationReason = window.prompt("Reason for cancellation");
    if (!cancellationReason?.trim()) return;
    try {
      await appointmentRequest(`appointments/${record.id}/cancel`, {
        method: "POST",
        body: { reason: cancellationReason.trim() },
      });
      toast.success("Appointment cancelled.");
      await loadSchedule();
    } catch (error) {
      toast.error(errorMessage(error, "Appointment could not be cancelled."));
    }
  };

  const checkIn = async (record: AppointmentRecord) => {
    try {
      const { data } = await appointmentRequest<{ visit_no: string; ticket_no: string; stage: string }>(
        `appointments/${record.id}/check-in`, { method: "POST" },
      );
      toast.success(`Checked in. Ticket ${data.ticket_no} · ${data.stage}.`);
      await loadSchedule();
    } catch (error) {
      toast.error(errorMessage(error, "Patient could not be checked in."));
    }
  };

  const reschedule = async (record: AppointmentRecord) => {
    if (!scheduleIsCurrent) {
      toast.error("Wait for the selected clinic schedule to finish loading.");
      return;
    }
    const newSlotId = rescheduleSlotIds[record.id];
    if (!newSlotId) {
      toast.error("Choose an available slot to reschedule.");
      return;
    }
    const changeReason = window.prompt("Reason for rescheduling");
    if (!changeReason?.trim()) return;
    try {
      await appointmentRequest(`appointments/${record.id}/reschedule`, {
        method: "POST",
        body: { slotId: newSlotId, reason: changeReason.trim() },
      });
      toast.success("Appointment rescheduled.");
      setRescheduleSlotIds((current) => ({ ...current, [record.id]: "" }));
      await loadSchedule();
    } catch (error) {
      toast.error(errorMessage(error, "Appointment could not be rescheduled."));
    }
  };

  const completeAppointment = async (record: AppointmentRecord) => {
    try {
      await appointmentRequest(`appointments/${record.id}/complete`, { method: "POST" });
      toast.success("Appointment completed.");
      await loadSchedule();
    } catch (error) {
      toast.error(errorMessage(error, "Appointment could not be completed."));
    }
  };

  const startTemplateEdit = (template: ClinicTemplate) => {
    setTemplateForm({
      editingId: template.id,
      orgUnitId: template.orgUnitId,
      providerStaffId: template.providerStaffId ?? "",
      weekday: String(template.weekday),
      startTime: template.startTime.slice(0, 5),
      endTime: template.endTime.slice(0, 5),
      slotMinutes: String(template.slotMinutes),
      capacityPerSlot: String(template.capacityPerSlot),
      overbookLimit: String(template.overbookLimit),
      consultationServiceId: template.consultationServiceId ?? "",
      validFrom: template.validFrom,
      validTo: template.validTo ?? "",
      active: template.active,
    });
  };

  const saveTemplate = async () => {
    if (!templateForm.orgUnitId) {
      toast.error("Choose a clinic.");
      return;
    }
    const { editingId, ...fields } = templateForm;
    setBusy(true);
    try {
      await appointmentRequest(
        editingId ? `clinic-session-templates/${editingId}` : "clinic-session-templates",
        {
          method: editingId ? "PATCH" : "POST",
          body: {
            ...fields,
            providerStaffId: fields.providerStaffId || null,
            consultationServiceId: fields.consultationServiceId || null,
            validTo: fields.validTo || null,
            weekday: Number(fields.weekday),
            slotMinutes: Number(fields.slotMinutes),
            capacityPerSlot: Number(fields.capacityPerSlot),
            overbookLimit: Number(fields.overbookLimit),
          },
        },
      );
      toast.success(editingId ? "Clinic session updated." : "Clinic session created.");
      setTemplateForm((current) => ({ ...current, editingId: "" }));
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error, "Clinic session could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const dateSlots = visibleSlots.filter((slot) => slot.startsAt.slice(0, 10) === selectedDate);
  const dateAppointments = visibleAppointments.filter((record) => record.scheduledStart.slice(0, 10) === selectedDate);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-muted-foreground">Book roster-backed clinic slots, check in patients and manage clinic sessions.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          <RefreshCw aria-hidden="true" className="mr-2 size-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Clinic calendar</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-2">
              <Label>Clinic</Label>
              <SearchableSelect
                options={unitOptions}
                value={unitId}
                onValueChange={setUnitId}
                placeholder="Choose a clinic"
                searchPlaceholder="Search clinics…"
              />
            </div>
            <Button variant="outline" onClick={() => setWeekStart((current) => shiftDate(current, -7))} aria-label="Previous week">
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="outline" onClick={() => setWeekStart(today())}>Today</Button>
            <Button variant="outline" onClick={() => setWeekStart((current) => shiftDate(current, 7))} aria-label="Next week">
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {days.map((day) => (
              <Button
                type="button"
                key={day}
                variant={selectedDate === day ? "default" : "outline"}
                className="h-auto min-h-14 flex-col"
                onClick={() => setSelectedDate(day)}
              >
                <span>{dateLabel(day)}</span>
                <span className="text-xs opacity-75">
                  {visibleSlots.filter((slot) => slot.startsAt.slice(0, 10) === day && slot.available).length} open
                </span>
              </Button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <h3 className="font-medium">Available slots · {dateLabel(selectedDate)}</h3>
              {scheduleLoading ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" role="status">Loading the selected clinic schedule…</p>
              ) : !unitId ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Choose a clinic to view bookable slots.</p>
              ) : !scheduleIsCurrent ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Schedule is unavailable. Refresh to try again.</p>
              ) : dateSlots.filter((slot) => slot.available).length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No bookable slots. Slots appear only when clinic providers are rostered.
                </p>
              ) : dateSlots.filter((slot) => slot.available).map((slot) => (
                <button
                  type="button"
                  key={slot.id}
                  disabled={!scheduleIsCurrent}
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`w-full rounded-md border p-3 text-left ${selectedSlotId === slot.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium"><Clock3 className="mr-1 inline size-4" />{timeLabel(slot.startsAt)}–{timeLabel(slot.endsAt)}</span>
                    <Badge variant="outline">{slot.remainingCapacity} available</Badge>
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {slot.providerName}
                    {slot.providerEmployeeId ? ` · Employee ID: ${slot.providerEmployeeId}` : ""}
                  </span>
                </button>
              ))}
            </div>
            <div className="space-y-3 rounded-md border p-4">
              <h3 className="font-medium">Book an appointment</h3>
              <div className="space-y-2">
                <Label>Patient</Label>
                <AppointmentPatientSearch value={patientChoice} onChange={setPatientChoice} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Appointment type</Label>
                  <Select value={appointmentType} onValueChange={setAppointmentType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{appointmentTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Booked via</Label>
                  <Select value={bookedVia} onValueChange={setBookedVia}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FRONT_DESK">Front desk</SelectItem><SelectItem value="PHONE">Phone</SelectItem>
                      <SelectItem value="ONLINE">Online</SelectItem><SelectItem value="REFERRAL">Referral</SelectItem><SelectItem value="CLINIC">Clinic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="appointment-reason">Reason (optional)</Label>
                <Input id="appointment-reason" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} />
              </div>
              <Button disabled={busy || !scheduleIsCurrent || !selectedSlotId || !patientChoice} onClick={() => void createAppointment()}>
                <Plus aria-hidden="true" className="mr-2 size-4" /> Book appointment
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Appointments · {dateLabel(selectedDate)}</CardTitle>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {["BOOKED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED"].map((status) =>
                <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-2">
          {scheduleLoading ? <p className="text-sm text-muted-foreground" role="status">Loading appointments…</p> : null}
          {!scheduleLoading && scheduleIsCurrent && dateAppointments.length === 0 ? <p className="text-sm text-muted-foreground">No appointments for this date.</p> : null}
          {dateAppointments.map((record) => (
            <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-56">
                <p className="font-medium">{timeLabel(record.scheduledStart)} · {record.patientName}</p>
                <p className="text-sm text-muted-foreground">
                  {record.providerName ?? "Clinic team"}{record.providerEmployeeId ? ` · Employee ID: ${record.providerEmployeeId}` : ""} · {(record.appointmentType ?? "Appointment").replaceAll("_", " ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={record.status === "BOOKED" ? "secondary" : "outline"}>{record.status.replaceAll("_", " ")}</Badge>
                {["BOOKED", "CONFIRMED"].includes(record.status) ? (
                  <>
                    <Button size="sm" onClick={() => void checkIn(record)}>Check in</Button>
                    <div className="min-w-52">
                      <SearchableSelect
                        options={rescheduleSlotOptions}
                        disabled={rescheduleSlotsLoading || rescheduleSlotsUnitId !== unitId}
                        value={rescheduleSlotIds[record.id] ?? ""}
                        onValueChange={(value) => setRescheduleSlotIds((current) => ({ ...current, [record.id]: value }))}
                        placeholder="New slot"
                        searchPlaceholder="Search available times…"
                      />
                    </div>
                    <Button size="sm" variant="outline" disabled={!rescheduleSlotIds[record.id] || rescheduleSlotsLoading || rescheduleSlotsUnitId !== unitId} onClick={() => void reschedule(record)}>Reschedule</Button>
                    <Button size="sm" variant="outline" onClick={() => void cancelAppointment(record)}>Cancel</Button>
                  </>
                ) : null}
                {["CHECKED_IN", "IN_PROGRESS"].includes(record.status) ? <Button size="sm" onClick={() => void completeAppointment(record)}>Complete</Button> : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Rebooking tasks</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {visibleRebookTasks.length === 0 ? <p className="text-sm text-muted-foreground">No patients need rebooking.</p> : null}
          {visibleRebookTasks.map((task) => (
            <div key={task.task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
              <div><p className="font-medium">{task.patientName} · {task.unitName}</p><p className="text-sm text-muted-foreground">Appointment slot changed · {new Date(task.appointment.scheduledStart).toLocaleString()}</p></div>
              <Badge variant="destructive">Needs rebooking</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Clinic session templates</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2"><Label>Clinic</Label><SearchableSelect options={unitOptions} value={templateForm.orgUnitId} onValueChange={(value) => setTemplateForm({ ...templateForm, orgUnitId: value })} placeholder="Choose clinic" searchPlaceholder="Search clinics…" /></div>
            <div className="space-y-2"><Label>Provider (optional)</Label><SearchableSelect options={providerOptions} value={templateForm.providerStaffId} onValueChange={(value) => setTemplateForm({ ...templateForm, providerStaffId: value })} placeholder="Pooled clinic" searchPlaceholder="Search staff…" /></div>
            <div className="space-y-2"><Label>Consultation service</Label><SearchableSelect options={serviceOptions} value={templateForm.consultationServiceId} onValueChange={(value) => setTemplateForm({ ...templateForm, consultationServiceId: value })} placeholder="Optional" searchPlaceholder="Search services…" /></div>
            <div className="space-y-2"><Label>Weekday</Label><Select value={templateForm.weekday} onValueChange={(value) => setTemplateForm({ ...templateForm, weekday: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{weekdayOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>Start</Label><Input type="time" value={templateForm.startTime} onChange={(event) => setTemplateForm({ ...templateForm, startTime: event.target.value })} /></div>
            <div className="space-y-2"><Label>End</Label><Input type="time" value={templateForm.endTime} onChange={(event) => setTemplateForm({ ...templateForm, endTime: event.target.value })} /></div>
            <div className="space-y-2"><Label>Minutes per slot</Label><Input type="number" min={5} max={120} value={templateForm.slotMinutes} onChange={(event) => setTemplateForm({ ...templateForm, slotMinutes: event.target.value })} /></div>
            <div className="space-y-2"><Label>Capacity per provider</Label><Input type="number" min={1} value={templateForm.capacityPerSlot} onChange={(event) => setTemplateForm({ ...templateForm, capacityPerSlot: event.target.value })} /></div>
            <div className="space-y-2"><Label>Overbook limit</Label><Input type="number" min={0} value={templateForm.overbookLimit} onChange={(event) => setTemplateForm({ ...templateForm, overbookLimit: event.target.value })} /></div>
            <div className="space-y-2"><Label>Valid from</Label><Input type="date" value={templateForm.validFrom} onChange={(event) => setTemplateForm({ ...templateForm, validFrom: event.target.value })} /></div>
            <div className="space-y-2"><Label>Valid to (optional)</Label><Input type="date" value={templateForm.validTo} onChange={(event) => setTemplateForm({ ...templateForm, validTo: event.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={templateForm.active} onChange={(event) => setTemplateForm({ ...templateForm, active: event.target.checked })} /> Active</label>
          </div>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void saveTemplate()}>{templateForm.editingId ? "Save session" : "Add session"}</Button>
            {templateForm.editingId ? <Button variant="outline" onClick={() => setTemplateForm((current) => ({ ...current, editingId: "" }))}>Stop editing</Button> : null}
          </div>
          <div className="space-y-2">
            {templates.map((template) => (
              <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>{template.unitName} · {weekdayOptions[template.weekday - 1]?.label} · {template.startTime.slice(0, 5)}–{template.endTime.slice(0, 5)} · {template.providerName}{template.providerEmployeeId ? ` · Employee ID: ${template.providerEmployeeId}` : ""}</span>
                <Button size="sm" variant="outline" onClick={() => startTemplateEdit(template)}>Edit</Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays className="size-4" /> Future slots are generated only for rostered clinical staff. Public holidays are excluded.</div>
        </CardContent>
      </Card>
    </div>
  );
}
