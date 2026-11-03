import { useState } from "react";
import { useNotification } from "@refinedev/core";

import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const StaffDeactivation = ({
  staffId,
  status,
  onDeactivated,
}: {
  staffId: string;
  status?: string;
  onDeactivated: () => void;
}) => {
  const { open: notify } = useNotification();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const deactivate = async () => {
    if (!reason.trim()) {
      notify?.({ type: "error", message: "A deactivation reason is required." });
      return;
    }
    try {
      setSaving(true);
      const response = await fetch(`${apiBase}/v1/staff/${staffId}/deactivate`, {
        method: "POST",
        credentials: "include",
        headers: createAuthHeaders(),
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.message || payload.error || "Failed to deactivate staff.");
      notify?.({ type: "success", message: "Staff member deactivated and future shifts cancelled." });
      setReason("");
      onDeactivated();
    } catch (error) {
      notify?.({ type: "error", message: error instanceof Error ? error.message : "Failed to deactivate staff." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Staff status</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {status !== "active" ? (
          <p className="text-sm text-muted-foreground">This staff member is inactive.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Deactivation disables the linked login and cancels future roster entries.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="deactivation-reason">Reason</Label>
              <Input
                id="deactivation-reason"
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter the reason for deactivation"
              />
            </div>
            <Button variant="destructive" onClick={deactivate} disabled={saving} className="cursor-pointer">
              {saving ? "Deactivating..." : "Deactivate staff"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};
