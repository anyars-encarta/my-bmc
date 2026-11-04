import { useCallback, useEffect, useState } from "react";
import { useGetIdentity } from "@refinedev/core";
import { toast } from "sonner";

import { BACKEND_BASE_URL } from "@/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { createAuthHeaders } from "@/providers/me";

type Holiday = { holidayDate: string; name: string };
type Envelope<T> = { data?: T; error?: string; message?: string; warnings?: string[] };
type Identity = { role?: string; roles?: string[] };

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const PublicHolidaysPage = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const roles = identity?.roles ?? (identity?.role ? [identity.role] : []);
  const canManage = roles.some((role) => ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"].includes(role));
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [name, setName] = useState("");
  const [editingDate, setEditingDate] = useState("");
  const [loading, setLoading] = useState(false);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/${path}`, {
      ...init,
      credentials: "include",
      headers: createAuthHeaders(init?.headers),
    });
    const payload = (await response.json()) as Envelope<T>;
    if (!response.ok) throw new Error(payload.message || payload.error || "The holiday request failed.");
    return payload;
  }, []);

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await request<Holiday[]>("public-holidays?from=2025-01-01&to=2035-12-31");
      setHolidays(payload.data ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load public holidays.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadHolidays();
  }, [loadHolidays]);

  const resetForm = () => {
    setHolidayDate("");
    setName("");
    setEditingDate("");
  };

  const save = async () => {
    if (!holidayDate || !name.trim()) {
      toast.error("Enter a holiday date and name.");
      return;
    }
    setLoading(true);
    try {
      const path = editingDate ? `public-holidays/${encodeURIComponent(editingDate)}` : "public-holidays";
      const payload = await request<Holiday>(path, {
        method: editingDate ? "PATCH" : "POST",
        body: JSON.stringify({ holidayDate, name: name.trim() }),
      });
      payload.warnings?.forEach((warning) => toast.warning(warning));
      if (!payload.warnings?.length) toast.success(editingDate ? "Holiday updated." : "Holiday added.");
      resetForm();
      await loadHolidays();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save public holiday.");
    } finally {
      setLoading(false);
    }
  };

  const seed = async () => {
    setLoading(true);
    try {
      const payload = await request<{ inserted: number }>("public-holidays/seed", { method: "POST" });
      toast.success(`${payload.data?.inserted ?? 0} Ghana holiday date(s) added.`);
      await loadHolidays();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to seed Ghana holidays.");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (holiday: Holiday) => {
    setLoading(true);
    try {
      const payload = await request<Holiday>(`public-holidays/${encodeURIComponent(holiday.holidayDate)}`, {
        method: "DELETE",
      });
      payload.warnings?.forEach((warning) => toast.warning(warning));
      if (!payload.warnings?.length) toast.success("Holiday removed.");
      if (editingDate === holiday.holidayDate) resetForm();
      await loadHolidays();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove public holiday.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Public holidays" />
      <Card>
        <CardHeader><CardTitle>Ghana holiday calendar</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Weekday schedules skip the dates in this calendar. Seed recurring national dates and Easter holidays, then add officially announced lunar holidays or one-off observances here.
          </p>
          {canManage ? (
            <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto_auto] md:items-end">
              <Field label="Holiday date">
                <Input type="date" value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} />
              </Field>
              <Field label="Holiday name">
                <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="e.g. Eid ul-Fitr" />
              </Field>
              <Button onClick={() => void save()} disabled={loading} className="cursor-pointer">
                {editingDate ? "Save changes" : "Add holiday"}
              </Button>
              {editingDate ? <Button variant="outline" onClick={resetForm} disabled={loading} className="cursor-pointer">Cancel edit</Button> : (
                <Button variant="outline" onClick={() => void seed()} disabled={loading} className="cursor-pointer">Seed Ghana holidays</Button>
              )}
            </div>
          ) : null}
          <div className="space-y-2">
            {loading && holidays.length === 0 ? <p className="text-sm text-muted-foreground">Loading holidays…</p> : null}
            {!loading && holidays.length === 0 ? <p className="text-sm text-muted-foreground">No public holidays are configured.</p> : null}
            {holidays.map((holiday) => (
              <div key={holiday.holidayDate} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{holiday.name}</p>
                  <p className="text-sm text-muted-foreground">{holiday.holidayDate}</p>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button variant="outline" disabled={loading} onClick={() => {
                      setEditingDate(holiday.holidayDate);
                      setHolidayDate(holiday.holidayDate);
                      setName(holiday.name);
                    }} className="cursor-pointer">
                      Edit
                    </Button>
                    <Button variant="destructive" disabled={loading} onClick={() => void remove(holiday)} className="cursor-pointer">Remove</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </ListView>
  );
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}
