import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { BACKEND_BASE_URL } from "@/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { createAuthHeaders } from "@/providers/me";

type Envelope<T> = { data?: T; error?: string; message?: string };
type ScheduleEntry = {
  id: string;
  rosterPeriodId: string | null;
  employeeId: string;
  staffName: string;
  orgUnitId: string;
  unitName: string;
  rosterDate: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  plannedStart: string;
  plannedEnd: string;
  source: string;
  status: string | null;
};
type EligibleShift = {
  id: string;
  employeeId: string;
  staffName: string;
  rosterDate: string;
  shiftName: string;
};
type SwapRequest = {
  id: string;
  status: string;
  reason: string | null;
  requester: { employeeId: string; name: string; date: string; shift: string };
  counterparty: { employeeId: string; name: string; date: string; shift: string } | null;
  canAccept: boolean;
  canReject: boolean;
};
type NotificationRecord = {
  id: string;
  template: string;
  payload: Record<string, unknown>;
  status: string;
  createdAt: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (date: string, count: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
};

export const MySchedulePage = () => {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDays(today(), 30));
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState("");
  const [eligibleShifts, setEligibleShifts] = useState<EligibleShift[]>([]);
  const [counterpartyEntryId, setCounterpartyEntryId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit): Promise<Envelope<T>> => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as Envelope<T>;
    if (!response.ok) throw new Error(payload.message || payload.error || "The schedule request failed.");
    return payload;
  }, []);

  const loadSelfService = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const [schedulePayload, swapPayload, notificationPayload] = await Promise.all([
        request<ScheduleEntry[]>(`me/schedule${suffix}`),
        request<SwapRequest[]>("shift-swaps"),
        request<NotificationRecord[]>("me/notifications"),
      ]);
      setSchedule(schedulePayload.data ?? []);
      setSwaps(swapPayload.data ?? []);
      setNotifications(notificationPayload.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load your schedule.");
    } finally {
      setLoading(false);
    }
  }, [from, request, to]);

  useEffect(() => {
    void loadSelfService();
  }, [loadSelfService]);

  useEffect(() => {
    if (!selectedEntryId) {
      setEligibleShifts([]);
      setCounterpartyEntryId("");
      return;
    }
    let active = true;
    request<EligibleShift[]>(`shift-swaps/eligible?entryId=${encodeURIComponent(selectedEntryId)}`)
      .then((payload) => {
        if (active) setEligibleShifts(payload.data ?? []);
      })
      .catch((error: unknown) => {
        if (active) toast.error(error instanceof Error ? error.message : "Unable to load available shifts.");
      });
    return () => { active = false; };
  }, [request, selectedEntryId]);

  const ownSwapEntries = useMemo(() =>
    schedule.filter((entry) => entry.rosterPeriodId && entry.status === "PUBLISHED"),
  [schedule]);
  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, ScheduleEntry[]>();
    for (const entry of schedule) {
      const entries = grouped.get(entry.rosterDate) ?? [];
      entries.push(entry);
      grouped.set(entry.rosterDate, entries);
    }
    return grouped;
  }, [schedule]);
  const calendarDays = useMemo(() => {
    if (!from || !to || from > to) return [];
    const count = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;
    if (count > 93) return [];
    const dates: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
    return dates;
  }, [from, to]);
  const unreadNotifications = notifications.filter((notification) => notification.status !== "READ");

  const submitSwap = async () => {
    if (!selectedEntryId || !counterpartyEntryId || !reason.trim()) {
      toast.error("Choose your shift, a colleague's shift, and enter a reason.");
      return;
    }
    setLoading(true);
    try {
      await request("shift-swaps", {
        method: "POST",
        body: JSON.stringify({
          requesterEntryId: selectedEntryId,
          counterpartyEntryId,
          reason: reason.trim(),
        }),
      });
      toast.success("Shift swap request sent.");
      setSelectedEntryId("");
      setCounterpartyEntryId("");
      setReason("");
      await loadSelfService();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to request shift swap.");
    } finally {
      setLoading(false);
    }
  };

  const decideSwap = async (swapId: string, action: "accept" | "reject") => {
    setLoading(true);
    try {
      await request(`shift-swaps/${swapId}/${action}`, { method: "POST" });
      toast.success(action === "accept" ? "Swap accepted and sent for manager approval." : "Swap request rejected.");
      await loadSelfService();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update swap request.");
    } finally {
      setLoading(false);
    }
  };

  const markRead = async (notificationId: string) => {
    setLoading(true);
    try {
      await request(`me/notifications/${notificationId}/read`, { method: "POST" });
      setNotifications((current) => current.map((record) =>
        record.id === notificationId ? { ...record, status: "READ" } : record,
      ));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to mark notification as read.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="My schedule" />
      <Card>
        <CardHeader><CardTitle>Published shifts and automatic weekday schedule</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
            <Button variant="outline" onClick={() => void loadSelfService()} disabled={loading} className="cursor-pointer">Refresh schedule</Button>
          </div>
          {loading && schedule.length === 0 ? <p className="text-sm text-muted-foreground">Loading your schedule…</p> : null}
          {from > to ? <p className="text-sm text-destructive">The start date must be on or before the end date.</p> : null}
          {calendarDays.length === 0 && from <= to ? <p className="text-sm text-destructive">Choose a date range of no more than 93 days.</p> : null}
          <div className="space-y-2">
            {calendarDays.map((date) => {
              const entries = scheduleByDate.get(date) ?? [];
              return (
                <div key={date} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                  <div>
                    <p className="font-medium">{date}</p>
                    {entries.length === 0 ? <p className="text-sm text-muted-foreground">Off day</p> : entries.map((entry) => (
                      <p key={entry.id} className="text-sm text-muted-foreground">
                        {entry.shiftName} · {entry.startTime}–{entry.endTime} · {entry.unitName} · {entry.source === "AUTO_FIXED" ? "Automatic weekday schedule" : entry.status}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Request a shift swap</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Your published shift">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selectedEntryId} onChange={(event) => setSelectedEntryId(event.target.value)}>
              <option value="">Choose one of your shifts</option>
              {ownSwapEntries.map((entry) => <option key={entry.id} value={entry.id}>{entry.rosterDate} · {entry.shiftName} · {entry.unitName}</option>)}
            </select>
          </Field>
          <Field label="Colleague's shift">
            <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={counterpartyEntryId} onChange={(event) => setCounterpartyEntryId(event.target.value)} disabled={!eligibleShifts.length}>
              <option value="">Choose a shift in the same roster period</option>
              {eligibleShifts.map((entry) => <option key={entry.id} value={entry.id}>{entry.staffName} (Staff ID: {entry.employeeId}) · {entry.rosterDate} · {entry.shiftName}</option>)}
            </select>
          </Field>
          <Field label="Reason">
            <Input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Why do you need to swap?" />
          </Field>
          <div className="flex items-end">
            <Button onClick={() => void submitSwap()} disabled={loading || !selectedEntryId || !counterpartyEntryId || !reason.trim()} className="cursor-pointer">
              Send swap request
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shift swap requests</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {swaps.length === 0 ? <p className="text-sm text-muted-foreground">No shift swap requests.</p> : swaps.map((swap) => (
            <div key={swap.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-medium">{swap.requester.name} · {swap.requester.date} · {swap.requester.shift}</p>
                <p className="text-sm text-muted-foreground">
                  {swap.counterparty ? `${swap.counterparty.name} · ${swap.counterparty.date} · ${swap.counterparty.shift}` : "No colleague selected"}
                  {" · "}{swap.status}{" · "}{swap.reason ?? ""}
                </p>
              </div>
              <div className="flex gap-2">
                {swap.canAccept ? <Button disabled={loading} onClick={() => void decideSwap(swap.id, "accept")} className="cursor-pointer">Accept</Button> : null}
                {swap.canReject ? <Button variant="outline" disabled={loading} onClick={() => void decideSwap(swap.id, "reject")} className="cursor-pointer">Reject</Button> : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notifications ({unreadNotifications.length} unread)</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {notifications.length === 0 ? <p className="text-sm text-muted-foreground">No notifications.</p> : notifications.map((notification) => {
            const payload = notification.payload;
            const publishedMessage = notification.template === "ROSTER_PUBLISHED"
              ? `Your roster for ${String(payload.unitName ?? "your unit")} (${String(payload.startDate ?? "")} – ${String(payload.endDate ?? "")}) is published.`
              : notification.template === "SHIFT_SWAP_APPROVED"
                ? `Your shift swap for ${String(payload.unitName ?? "your unit")} was approved.`
                : notification.template;
            return (
              <div key={notification.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{publishedMessage}</p>
                  <p className="text-xs text-muted-foreground">{new Date(notification.createdAt).toLocaleString()} · {notification.status}</p>
                </div>
                {notification.status !== "READ" ? <Button variant="outline" disabled={loading} onClick={() => void markRead(notification.id)}>Mark read</Button> : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </ListView>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
