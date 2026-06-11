import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BACKEND_BASE_URL } from "@/constants";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { PaymentStatus, StaffRecord } from "@/types/domain";
import { useGetIdentity, useList, useNotification } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";

type ApprovalPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  approvingOfficer?: string | null;
  category?: {
    name?: string;
  };
  recipients?: ApprovalRecipient[];
};

type ApprovalRecipient = {
  id: string;
  staffId: string;
  amount: string;
  status: "pending" | "approved" | "disapproved";
  staff?: {
    firstName?: string;
    lastName?: string;
    employeeId?: string;
  };
};

type Identity = {
  id: string;
  email?: string;
  fullName?: string;
  role?: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

const requestRecipients = async <T,>(
  url: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as { data?: T; error?: string }) : {};

  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || "Request failed");
  }

  return (payload?.data as T) ?? (payload as T);
};

export const ApprovalQueueList = () => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();

  const { result: paymentsResult, query: paymentsQuery } = useList<ApprovalPayment>({
    resource: "payments",
    pagination: {
      pageSize: 200,
    },
  });

  const { result: staffResult } = useList<StaffRecord>({
    resource: "staff",
    pagination: {
      pageSize: 500,
    },
  });

  const [selectedPayment, setSelectedPayment] = useState<ApprovalPayment | null>(null);
  const [recipients, setRecipients] = useState<ApprovalRecipient[]>([]);
  const [recipientAmounts, setRecipientAmounts] = useState<Record<string, string>>({});
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const staff = staffResult?.data ?? [];

  const queueItems = useMemo(() => {
    const payments = paymentsResult?.data ?? [];
    const identityTokens = [identity?.id, identity?.email, identity?.fullName]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim());

    return payments
      .filter((payment) => {
        if (identity?.role === "admin") {
          return true;
        }

        if (!payment.approvingOfficer) {
          return false;
        }

        const approver = payment.approvingOfficer.toLowerCase().trim();
        return identityTokens.includes(approver);
      })
      .map((payment) => {
        const pendingReviewCount = (payment.recipients ?? []).filter(
          (recipient) => recipient.status === "pending",
        ).length;

        return {
          id: payment.id,
          paymentTitle: payment.title,
          categoryName: payment.category?.name || "-",
          recipientsCount: payment.recipients?.length ?? 0,
          pendingReviewCount,
          totalAmount: payment.totalAmount,
          approvingOfficer: payment.approvingOfficer || "-",
          status: payment.status,
          raw: payment,
        };
      });
  }, [identity?.email, identity?.fullName, identity?.id, identity?.role, paymentsResult?.data]);

  const refreshRecipients = async (paymentId: string) => {
    const nextRecipients = await requestRecipients<ApprovalRecipient[]>(
      `${apiBase}/payments/${paymentId}/recipients`,
    );
    setRecipients(nextRecipients);
    setRecipientAmounts(
      nextRecipients.reduce<Record<string, string>>((acc, recipient) => {
        acc[recipient.id] = recipient.amount;
        return acc;
      }, {}),
    );
  };

  useEffect(() => {
    const paymentId = selectedPayment?.id;
    if (!paymentId) return;

    const run = async () => {
      try {
        await refreshRecipients(paymentId);
      } catch (error) {
        notify?.({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load beneficiaries.",
        });
      }
    };

    run();
  }, [notify, selectedPayment?.id]);

  const openReview = async (payment: ApprovalPayment) => {
    setSelectedPayment(payment);
  };

  const canManageRecipients = (payment: ApprovalPayment | null) =>
    payment ? ["draft", "pending_approval"].includes(payment.status) : false;

  const availableStaff = staff.filter(
    (member) => !recipients.some((recipient) => recipient.staffId === member.id),
  );

  const handleUpdateAmount = async (recipient: ApprovalRecipient) => {
    if (!selectedPayment) return;

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/recipients/${recipient.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ amount: recipientAmounts[recipient.id] || recipient.amount }),
        },
      );
      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      notify?.({ type: "success", message: "Beneficiary amount updated." });
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemoveRecipient = async (recipientId: string) => {
    if (!selectedPayment) return;

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/recipients/${recipientId}`,
        {
          method: "DELETE",
        },
      );
      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      notify?.({ type: "success", message: "Beneficiary removed." });
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to remove beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddRecipient = async () => {
    if (!selectedPayment || !selectedStaffId || !newAmount.trim()) {
      return;
    }

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/recipients`,
        {
          method: "POST",
          body: JSON.stringify({
            staffId: selectedStaffId,
            amount: newAmount.trim(),
          }),
        },
      );
      setSelectedStaffId("");
      setNewAmount("");
      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      notify?.({ type: "success", message: "Beneficiary added." });
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to add beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Approval Queue" canCreate={false} />
      {paymentsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading approvals...</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {queueItems.map((item, index) => (
          <Card
            key={item.id}
            className="border-0 shadow-sm ring-1 ring-border animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{item.paymentTitle}</CardTitle>
                <p className="text-sm text-muted-foreground">{item.categoryName}</p>
              </div>
              <Badge variant="outline" className={paymentStatusTone(item.status)}>
                {toTitleCase(item.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <DataLine label="Recipients" value={String(item.recipientsCount)} />
                <DataLine
                  label="Pending Verification"
                  value={String(item.pendingReviewCount)}
                />
                <DataLine label="Amount" value={formatCurrency(item.totalAmount)} />
                <DataLine label="Approver" value={item.approvingOfficer} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => openReview(item.raw)}>
                  Open Review
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReview(item.raw)}>
                  Manage Beneficiaries
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={Boolean(selectedPayment)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedPayment(null);
            setRecipients([]);
            setRecipientAmounts({});
            setSelectedStaffId("");
            setNewAmount("");
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Beneficiaries: {selectedPayment?.title || "Payment"}
            </DialogTitle>
            <DialogDescription>
              Approving officer can view, add, remove, and adjust individual beneficiary amounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Total beneficiaries: {recipients.length}
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {recipients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No beneficiaries added yet.</p>
              ) : (
                recipients.map((recipient) => (
                  <div key={recipient.id} className="rounded-md border p-3">
                    <div className="mb-2 text-sm font-medium">
                      {(recipient.staff?.firstName || "") + " " + (recipient.staff?.lastName || "") || "Unknown Staff"}
                      {recipient.staff?.employeeId ? ` (${recipient.staff.employeeId})` : ""}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-40 flex-1 space-y-1">
                        <Label htmlFor={`amount-${recipient.id}`}>Amount</Label>
                        <Input
                          id={`amount-${recipient.id}`}
                          value={recipientAmounts[recipient.id] ?? recipient.amount}
                          onChange={(event) => {
                            setRecipientAmounts((prev) => ({
                              ...prev,
                              [recipient.id]: event.target.value,
                            }));
                          }}
                          disabled={!canManageRecipients(selectedPayment) || isBusy}
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleUpdateAmount(recipient)}
                        disabled={!canManageRecipients(selectedPayment) || isBusy}
                      >
                        Save Amount
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemoveRecipient(recipient.id)}
                        disabled={!canManageRecipients(selectedPayment) || isBusy}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Add Beneficiary</p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-2">
                  <Label>Staff</Label>
                  <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select staff" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableStaff.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                          {member.firstName} {member.lastName} ({member.employeeId})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Amount</Label>
                  <Input
                    value={newAmount}
                    onChange={(event) => setNewAmount(event.target.value)}
                    placeholder="0.00"
                    disabled={!canManageRecipients(selectedPayment) || isBusy}
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={handleAddRecipient}
                disabled={!canManageRecipients(selectedPayment) || isBusy || !selectedStaffId || !newAmount}
              >
                Add Beneficiary
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedPayment(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListView>
  );
};

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
