import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, registryRequest } from "@/lib/patients-api";
import type { BreakGlassGrant } from "@/types/patients";

const RESTRICTION_TEXT: Record<string, string> = {
  VIP: "This is a VIP record.",
  RESTRICTED: "This record is marked restricted.",
  SELF: "This is your own patient record.",
};

/** Asks for the reason, then requests a four-hour break-glass grant for a restricted record. */
export function BreakGlassDialog({
  open,
  onOpenChange,
  patientId,
  restriction,
  minReasonLength,
  onGranted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  restriction?: string | null;
  minReasonLength: number;
  onGranted: (grant: BreakGlassGrant) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const remaining = Math.max(0, minReasonLength - reason.trim().length);

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const submit = async () => {
    if (remaining > 0) return;
    setSaving(true);
    try {
      const result = await registryRequest<BreakGlassGrant>("break-glass", {
        method: "POST",
        body: { patientId, reason: reason.trim() },
      });
      toast.success("Break-glass access granted for 4 hours.");
      onGranted(result.data);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Break-glass access could not be granted."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />
            Break-glass access
          </DialogTitle>
          <DialogDescription>
            {(restriction && RESTRICTION_TEXT[restriction]) ?? "This record is restricted."} Access is
            granted for 4 hours, recorded in the audit trail, notified to the Data Protection Officer and
            reviewed within 2 working days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="break-glass-reason">Why do you need to open this record?</Label>
          <Textarea
            id="break-glass-reason"
            value={reason}
            maxLength={500}
            rows={4}
            autoFocus
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Treating this patient in the emergency unit"
          />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {remaining > 0
              ? `Enter at least ${remaining} more character${remaining === 1 ? "" : "s"}.`
              : "Your reason will be shown to the reviewer."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={saving || remaining > 0}>
            {saving ? "Requesting..." : "Open record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
