import { useEffect, useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { getPublicApiBase } from "@/lib/public-api";

type QueueUnit = { code: string; name: string };
type PublicQueue = {
  unitName: string;
  tickets: Array<{ ticketNo: string; stage: string; status: string; issuedAt: string }>;
};

const apiBase = getPublicApiBase();

export function PublicQueuePage() {
  const [units, setUnits] = useState<QueueUnit[]>([]);
  const [unitCode, setUnitCode] = useState("");
  const [queue, setQueue] = useState<PublicQueue | null>(null);
  const [error, setError] = useState("");
  const [queueLoading, setQueueLoading] = useState(false);
  const options = useMemo<SearchableSelectOption[]>(() =>
    units.map((unit) => ({ value: unit.code, label: unit.name })), [units]);

  useEffect(() => {
    fetch(`${apiBase}/public/queue-units`)
      .then(async (response) => {
        const payload = await response.json() as { data?: QueueUnit[]; message?: string };
        if (!response.ok) throw new Error(payload.message || "Clinics could not be loaded.");
        setUnits(payload.data ?? []);
        setUnitCode((current) => current || payload.data?.[0]?.code || "");
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Clinics could not be loaded."));
  }, []);

  useEffect(() => {
    if (!unitCode) {
      setQueue(null);
      setQueueLoading(false);
      return;
    }
    setQueue(null);
    setQueueLoading(true);
    setError("");
    const query = new URLSearchParams({ unitCode });
    const stream = new EventSource(`${apiBase}/public/queue/stream?${query.toString()}`);
    stream.onmessage = (event) => {
      try {
        setQueue(JSON.parse(event.data) as PublicQueue);
        setQueueLoading(false);
        setError("");
      } catch {
        setQueueLoading(false);
        setError("Queue display data could not be read.");
      }
    };
    stream.onerror = () => {
      setQueueLoading(false);
      setError("Live queue is unavailable. Reconnecting…");
    };
    return () => stream.close();
  }, [unitCode]);

  const selectedUnitName = units.find((unit) => unit.code === unitCode)?.name;
  const heading = queue?.unitName ?? (queueLoading
    ? `Loading ${selectedUnitName ?? "queue"}…`
    : error ? `${selectedUnitName ?? "Queue"} unavailable` : "Queue display");
  const selectUnit = (code: string) => {
    setQueue(null);
    setQueueLoading(Boolean(code));
    setError("");
    setUnitCode(code);
  };

  return (
    <main className="min-h-screen bg-background p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-sm font-medium uppercase tracking-wide text-primary">Encarta · Patient queue</p><h1 className="text-3xl font-semibold sm:text-5xl">{heading}</h1></div>
          <div className="w-full max-w-sm space-y-2"><Label>Clinic</Label><SearchableSelect options={options} value={unitCode} onValueChange={selectUnit} placeholder="Choose a clinic" searchPlaceholder="Search clinics…" /></div>
        </div>
        {error ? <p className="rounded-md border border-destructive/40 p-3 text-destructive" role="status">{error}</p> : null}
        {queueLoading ? <p className="py-16 text-center text-xl text-muted-foreground" role="status">Connecting to the selected clinic queue…</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(queue?.tickets ?? []).map((ticket) => (
            <Card key={`${ticket.ticketNo}-${ticket.stage}`} className="border-primary/20">
              <CardContent className="space-y-2 p-6 text-center sm:p-8">
                <p className="text-5xl font-bold tracking-wider sm:text-7xl">{ticket.ticketNo}</p>
                <p className="text-xl font-medium">{ticket.stage}</p>
                <p className="text-sm uppercase text-primary">{ticket.status === "SERVING" ? "Now serving" : "Please proceed"}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {queue && queue.tickets.length === 0 ? <p className="py-16 text-center text-xl text-muted-foreground">No tickets are being called right now.</p> : null}
        <p className="text-center text-xs text-muted-foreground">This public board displays ticket numbers only. It does not show patient names or record identifiers.</p>
      </div>
    </main>
  );
}
