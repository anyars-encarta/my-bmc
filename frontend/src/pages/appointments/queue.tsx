import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { appointmentRequest } from "@/lib/appointments-api";
import { errorMessage, withQuery } from "@/lib/patients-api";

type References = { units: Array<{ id: string; code: string; name: string }> };
type QueueRow = {
  ticket: {
    id: string;
    ticketNo: string;
    stage: string;
    priority: number;
    status: string;
    issuedAt: string;
    counter: string | null;
  };
  patientName: string;
  visitNo: string;
  unitName: string;
};
const stages = ["CASHIER", "TRIAGE", "CONSULTATION", "LAB", "IMAGING", "PHARMACY"];

export function QueueBoardPage() {
  const [units, setUnits] = useState<References["units"]>([]);
  const [unitId, setUnitId] = useState("");
  const [stage, setStage] = useState("ALL");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [rowsKey, setRowsKey] = useState("");
  const selectionRef = useRef({ unitId, stage });
  selectionRef.current = { unitId, stage };
  const selectionKey = `${unitId}|${stage}`;
  const visibleRows = rowsKey === selectionKey ? rows : [];
  const options = useMemo<SearchableSelectOption[]>(() =>
    units.map((unit) => ({ value: unit.id, label: `${unit.name} · ${unit.code}` })), [units]);

  useEffect(() => {
    appointmentRequest<References>("appointment-references")
      .then(({ data }) => {
        setUnits(data.units);
        setUnitId((current) => current || data.units[0]?.id || "");
      })
      .catch((error: unknown) => toast.error(errorMessage(error, "Clinics could not be loaded.")));
  }, []);

  useEffect(() => {
    if (!unitId) return;
    let active = true;
    const requestKey = `${unitId}|${stage}`;
    setRows([]);
    setRowsKey("");
    const load = async () => {
      try {
        const { data } = await appointmentRequest<QueueRow[]>(
          withQuery("queue", { unitId, stage: stage === "ALL" ? "" : stage }),
        );
        if (active) {
          setRows(data);
          setRowsKey(requestKey);
        }
      } catch (error) {
        if (active) toast.error(errorMessage(error, "Queue could not be refreshed."));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [unitId, stage]);

  const action = async (row: QueueRow, operation: "call" | "recall" | "serve" | "skip" | "complete") => {
    try {
      await appointmentRequest(`queue/${row.ticket.id}/${operation}`, {
        method: "POST",
        body: { counter: row.ticket.counter },
      });
      toast.success(`Ticket ${row.ticket.ticketNo} updated.`);
      const requestSelection = { unitId, stage };
      const requestKey = `${requestSelection.unitId}|${requestSelection.stage}`;
      const { data } = await appointmentRequest<QueueRow[]>(withQuery("queue", {
        unitId: requestSelection.unitId,
        stage: requestSelection.stage === "ALL" ? "" : requestSelection.stage,
      }));
      if (selectionRef.current.unitId === requestSelection.unitId && selectionRef.current.stage === requestSelection.stage) {
        setRows(data);
        setRowsKey(requestKey);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Queue ticket could not be updated."));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Queue board</h1>
        <p className="text-sm text-muted-foreground">Call, recall, skip and complete clinic queue tickets.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Queue</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2"><Label>Clinic</Label><SearchableSelect options={options} value={unitId} onValueChange={setUnitId} placeholder="Choose clinic" searchPlaceholder="Search clinics…" /></div>
            <div className="space-y-2"><Label>Stage</Label><Select value={stage} onValueChange={setStage}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All stages</SelectItem>{stages.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
          </div>
          {visibleRows.length === 0 ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No active tickets in this queue.</p> : null}
          <div className="space-y-2">
            {visibleRows.map((row) => (
              <div key={row.ticket.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
                <div><p className="font-semibold">{row.ticket.ticketNo} · {row.patientName}</p><p className="text-sm text-muted-foreground">{row.ticket.stage} · {row.ticket.status} · Priority {row.ticket.priority}</p></div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={row.ticket.status === "CALLED" ? "default" : "outline"}>{row.ticket.status}</Badge>
                  {row.ticket.status === "WAITING" ? <Button size="sm" onClick={() => void action(row, "call")}>Call</Button> : null}
                  {row.ticket.status === "CALLED" ? <><Button size="sm" variant="outline" onClick={() => void action(row, "recall")}>Recall</Button><Button size="sm" onClick={() => void action(row, "serve")}>Start serving</Button></> : null}
                  {row.ticket.status !== "DONE" && row.ticket.status !== "SKIPPED" ? <><Button size="sm" variant="outline" onClick={() => void action(row, "skip")}>Skip</Button><Button size="sm" variant="secondary" onClick={() => void action(row, "complete")}>Complete</Button></> : null}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Patient records are limited to authorised staff. Public displays show ticket number and stage only.</p>
        </CardContent>
      </Card>
    </div>
  );
}
