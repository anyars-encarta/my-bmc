import { useState } from "react";
import { toast } from "sonner";

import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { BREAK_GLASS_REVIEW_WRITE_ROLES, breakGlassOutcomeOptions, optionLabel } from "@/constants/patients";
import { useLoader, useRegistryAccess } from "@/hooks/use-registry";
import { formatDateTime } from "@/lib/patient-format";
import { errorMessage, registryRequest, withQuery } from "@/lib/patients-api";
import { Field, OptionSelect } from "@/pages/patients/form-parts";
import type { BreakGlassReviewItem } from "@/types/patients";

const statusOptions = [
  { value: "PENDING", label: "Waiting for review" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "ALL", label: "All" },
];

const outcomeVariant = (outcome: string | null) =>
  outcome === "JUSTIFIED" ? "default" : outcome === "UNJUSTIFIED" ? "destructive" : "secondary";

/** Review queue for break-glass access to restricted patient records (DPO and unit managers). */
export const BreakGlassReviewPage = () => {
  const { can } = useRegistryAccess();
  const canReview = can(BREAK_GLASS_REVIEW_WRITE_ROLES);
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<BreakGlassReviewItem | null>(null);
  const [outcome, setOutcome] = useState("JUSTIFIED");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, loading, error, reload } = useLoader(
    () => registryRequest<BreakGlassReviewItem[]>(withQuery("privacy/break-glass-reviews", { status, page, limit: 25 })),
    [status, page],
  );
  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const noteRequired = outcome !== "JUSTIFIED";

  const openReview = (row: BreakGlassReviewItem) => {
    setSelected(row);
    setOutcome("JUSTIFIED");
    setNote("");
  };

  const submit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await registryRequest(`privacy/break-glass-reviews/${selected.id}/review`, {
        method: "POST",
        body: { outcome, note: note.trim() || null },
      });
      toast.success("Review recorded.");
      setSelected(null);
      reload();
    } catch (caught) {
      toast.error(errorMessage(caught, "The review could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Break-glass review" canCreate={false} />
      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-64">
              <Field label="Show" htmlFor="break-glass-status">
                <OptionSelect
                  id="break-glass-status"
                  value={status}
                  onChange={(next) => {
                    setStatus(next);
                    setPage(1);
                  }}
                  options={statusOptions}
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              Every break-glass access must be reviewed within 2 working days.
            </p>
          </div>

          {error ? <p className="text-sm text-destructive" role="alert">{error.message}</p> : null}
          {!error && rows.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {loading ? "Loading..." : "No break-glass access matches this view."}
            </p>
          ) : null}
          {rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Accessed</TableHead>
                  <TableHead>Staff member</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Reason given</TableHead>
                  <TableHead>Review</TableHead>
                  {canReview ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(row.grantedAt)}
                      <span className="block text-xs text-muted-foreground">
                        {row.active ? `Active until ${formatDateTime(row.expiresAt)}` : "Expired"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.userName}
                      {row.userEmail ? <span className="block text-xs text-muted-foreground">{row.userEmail}</span> : null}
                    </TableCell>
                    <TableCell>
                      {row.patientName}
                      <span className="block text-xs text-muted-foreground">
                        {[
                          row.patientMrn,
                          row.confidentiality === "VIP" ? "VIP" : row.confidentiality === "RESTRICTED" ? "Restricted" : "Own record",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-sm whitespace-normal">{row.reason}</TableCell>
                    <TableCell>
                      {row.reviewOutcome ? (
                        <>
                          <Badge variant={outcomeVariant(row.reviewOutcome)}>
                            {optionLabel(breakGlassOutcomeOptions, row.reviewOutcome)}
                          </Badge>
                          <span className="block text-xs text-muted-foreground">
                            {[row.reviewedByName, formatDateTime(row.reviewedAt)].filter(Boolean).join(" · ")}
                          </span>
                          {row.reviewNote ? <span className="block text-xs">{row.reviewNote}</span> : null}
                        </>
                      ) : row.reviewOverdue ? (
                        <Badge variant="destructive">Overdue</Badge>
                      ) : (
                        <Badge variant="outline">Waiting</Badge>
                      )}
                    </TableCell>
                    {canReview ? (
                      <TableCell className="text-right">
                        {row.reviewOutcome ? null : (
                          <Button size="sm" onClick={() => openReview(row)}>
                            Review
                          </Button>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          {pagination && pagination.totalPages > 1 ? (
            <div className="flex items-center justify-end gap-3 text-sm">
              <span className="text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={!pagination.hasMore} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review break-glass access</DialogTitle>
            <DialogDescription>
              {selected
                ? `${selected.userName} opened ${selected.patientName}'s record on ${formatDateTime(selected.grantedAt)}: “${selected.reason}”`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Outcome" htmlFor="review-outcome">
              <OptionSelect id="review-outcome" value={outcome} onChange={setOutcome} options={breakGlassOutcomeOptions} />
            </Field>
            <Field
              label="Note"
              htmlFor="review-note"
              required={noteRequired}
              hint={noteRequired ? "Explain the decision in at least 10 characters." : "Optional"}
            >
              <Textarea
                id="review-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving || (noteRequired && note.trim().length < 10)}>
              {saving ? "Saving..." : "Record review"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListView>
  );
};
