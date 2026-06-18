import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import PageLoader from "@/components/PageLoader";
import {
  ShowView,
  ShowViewHeader,
} from "@/components/refine-ui/views/show-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BACKEND_BASE_URL } from "@/constants";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import { cn } from "@/lib/utils";
import type { PaymentStatus, StaffRecord } from "@/types/domain";
import { useGetIdentity, useNotification } from "@refinedev/core";
import { Check, ChevronsUpDown } from "lucide-react";

type ApprovalPayment = {
  id: string;
  title: string;
  status: PaymentStatus;
  totalAmount: string;
  period: string;
  approvingOfficer?: string | null;
  category?: {
    name?: string;
  };
};

type ApprovalRecipient = {
  id: string;
  staffId: string;
  amount: string;
  status: "pending" | "approved" | "disapproved";
  staff?: {
    id?: string;
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
  const payload = text
    ? (JSON.parse(text) as { data?: T; error?: string })
    : {};

  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || "Request failed");
  }

  return (payload?.data as T) ?? (payload as T);
};

export const ApprovalReviewPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const paymentId = id ?? "";
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();

  const [payment, setPayment] = useState<ApprovalPayment | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [recipients, setRecipients] = useState<ApprovalRecipient[]>([]);
  const [recipientAmounts, setRecipientAmounts] = useState<Record<string, string>>({});
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [selectedRecipientStaff, setSelectedRecipientStaff] = useState<StaffRecord | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

  const isAccountsUser = identity?.role === "accounts";
  const isBusy = busyActionKey !== null;
  const isActionBusy = (actionKey: string) => busyActionKey === actionKey;

  const refreshPayment = async () => {
    if (!paymentId) return;

    const nextPayment = await requestRecipients<ApprovalPayment>(
      `${apiBase}/payments/${paymentId}`,
    );
    setPayment(nextPayment);
  };

  const refreshRecipients = async () => {
    if (!paymentId) return;

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
    if (!paymentId) {
      setPaymentLoading(false);
      return;
    }

    const run = async () => {
      try {
        setPaymentLoading(true);
        await Promise.all([refreshPayment(), refreshRecipients()]);
        setSelectedRecipientIds([]);
      } catch (error) {
        notify?.({
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to load approval details.",
        });
      } finally {
        setPaymentLoading(false);
      }
    };

    void run();
  }, [paymentId, notify]);

  useEffect(() => {
    const run = async () => {
      try {
        setStaffLoading(true);
        const allStaff = await requestRecipients<StaffRecord[]>(`${apiBase}/staff`);
        setStaff(allStaff);
      } catch (error) {
        notify?.({
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to load staff list.",
        });
      } finally {
        setStaffLoading(false);
      }
    };

    void run();
  }, [notify]);

  const canManageRecipients = (currentPayment: ApprovalPayment | null) =>
    currentPayment ? ["draft", "pending_approval"].includes(currentPayment.status) : false;

  const allRecipientsReviewed =
    recipients.length > 0 &&
    recipients.every((recipient) => recipient.status !== "pending");

  const selectedRecipients = recipients.filter((recipient) =>
    selectedRecipientIds.includes(recipient.id),
  );
  const selectedPendingCount = selectedRecipients.filter(
    (recipient) => recipient.status === "pending",
  ).length;

  const approvalBlockReason = !payment
    ? ""
    : payment.status !== "pending_approval"
      ? "This batch can only be approved after submission."
      : recipients.length === 0
        ? "Add at least one beneficiary before approving."
        : recipients.some((recipient) => recipient.status === "pending")
          ? `${recipients.filter((recipient) => recipient.status === "pending").length} beneficiary${
              recipients.filter((recipient) => recipient.status === "pending").length === 1
                ? " is"
                : "ies are"
            } still awaiting review.`
          : "";

  const availableStaff = useMemo(() => {
    return staff.filter(
      (member) => !recipients.some((recipient) => recipient.staffId === member.id),
    );
  }, [recipients, staff]);

  const selectedStaff = availableStaff.find((member) => member.id === selectedStaffId);

  const openStaffDetails = (recipient: ApprovalRecipient) => {
    const matched = staff.find((member) => member.id === recipient.staffId);
    if (matched) {
      setSelectedRecipientStaff(matched);
      return;
    }

    setSelectedRecipientStaff({
      id: recipient.staffId,
      firstName: recipient.staff?.firstName || "Unknown",
      lastName: recipient.staff?.lastName || "Staff",
      employeeId: recipient.staff?.employeeId || "-",
      email: "-",
      momoNumber: "-",
      status: "active",
      department: "-",
      position: "-",
      imageUrl: "",
    });
  };

  const toggleRecipientSelection = (recipientId: string) => {
    setSelectedRecipientIds((current) =>
      current.includes(recipientId)
        ? current.filter((existingId) => existingId !== recipientId)
        : [...current, recipientId],
    );
  };

  const selectAllRecipients = () => {
    setSelectedRecipientIds(recipients.map((recipient) => recipient.id));
  };

  const clearRecipientSelection = () => {
    setSelectedRecipientIds([]);
  };

  const handleUpdateAmount = async (recipient: ApprovalRecipient) => {
    if (!payment) return;

    const actionKey = `update-${recipient.id}`;

    try {
      setBusyActionKey(actionKey);
      await requestRecipients(
        `${apiBase}/payments/${payment.id}/recipients/${recipient.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            amount: recipientAmounts[recipient.id] || recipient.amount,
          }),
        },
      );
      await Promise.all([refreshRecipients(), refreshPayment()]);
      notify?.({ type: "success", message: "Beneficiary amount updated." });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to update beneficiary.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleReviewRecipient = async (
    recipient: ApprovalRecipient,
    status: "approved" | "disapproved",
  ) => {
    if (!payment) return;

    const actionKey = `review-${status}-${recipient.id}`;

    try {
      setBusyActionKey(actionKey);
      await requestRecipients(
        `${apiBase}/payments/${payment.id}/recipients/${recipient.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        },
      );
      await Promise.all([refreshRecipients(), refreshPayment()]);
      notify?.({
        type: "success",
        message: `Beneficiary ${status === "approved" ? "approved" : "disapproved"}.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to review beneficiary.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleBulkReviewRecipients = async (status: "approved" | "disapproved") => {
    if (!payment || selectedRecipientIds.length === 0) {
      return;
    }

    const actionKey = `bulk-${status}`;

    try {
      setBusyActionKey(actionKey);
      for (const recipientId of selectedRecipientIds) {
        await requestRecipients(
          `${apiBase}/payments/${payment.id}/recipients/${recipientId}/review`,
          {
            method: "POST",
            body: JSON.stringify({ status }),
          },
        );
      }

      await Promise.all([refreshRecipients(), refreshPayment()]);
      setSelectedRecipientIds([]);
      notify?.({
        type: "success",
        message: `${selectedRecipientIds.length} beneficiar${
          selectedRecipientIds.length === 1 ? "y" : "ies"
        } ${status === "approved" ? "reviewed" : "disapproved"}.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to process selected beneficiaries.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleRemoveRecipient = async (recipientId: string) => {
    if (!payment) return;

    const actionKey = `remove-${recipientId}`;

    try {
      setBusyActionKey(actionKey);
      await requestRecipients(
        `${apiBase}/payments/${payment.id}/recipients/${recipientId}`,
        {
          method: "DELETE",
        },
      );
      await Promise.all([refreshRecipients(), refreshPayment()]);
      setSelectedRecipientIds((current) => current.filter((id) => id !== recipientId));
      notify?.({ type: "success", message: "Beneficiary removed." });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to remove beneficiary.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleAddRecipient = async () => {
    if (!payment || !selectedStaffId || !newAmount.trim()) {
      return;
    }

    const actionKey = "add-recipient";

    try {
      setBusyActionKey(actionKey);
      await requestRecipients(`${apiBase}/payments/${payment.id}/recipients`, {
        method: "POST",
        body: JSON.stringify({
          staffId: selectedStaffId,
          amount: newAmount.trim(),
        }),
      });
      setSelectedStaffId("");
      setNewAmount("");
      await Promise.all([refreshRecipients(), refreshPayment()]);
      notify?.({ type: "success", message: "Beneficiary added." });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to add beneficiary.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  const handleApproveBatch = async () => {
    if (!payment || !allRecipientsReviewed) {
      return;
    }

    const actionKey = "approve-batch";

    try {
      setBusyActionKey(actionKey);
      await requestRecipients(`${apiBase}/payments/${payment.id}/approve`, {
        method: "POST",
      });
      notify?.({ type: "success", message: "Payment batch approved." });
      navigate("/approvals");
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to approve batch.",
      });
    } finally {
      setBusyActionKey(null);
    }
  };

  if (paymentLoading) {
    return <PageLoader />;
  }

  if (!payment) {
    return (
      <ShowView className="space-y-4">
        <ShowViewHeader title="Approval Review" />
        <p className="text-sm text-destructive">Failed to load approval details.</p>
        <Button type="button" variant="outline" onClick={() => navigate("/approvals")}>
          Back to Approval Queue
        </Button>
      </ShowView>
    );
  }

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Approval Review" />

      <Card className="border-0 shadow-sm ring-1 ring-border">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{payment.title} - {payment.period}</CardTitle>
            <p className="text-sm text-muted-foreground">{payment.category?.name || "-"}</p>
          </div>
          <Badge variant="outline" className={paymentStatusTone(payment.status)}>
            {toTitleCase(payment.status)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <DataLine label="Recipients" value={String(recipients.length)} />
          <DataLine label="Amount" value={formatCurrency(payment.totalAmount)} />
          <DataLine label="Approver" value={payment.approvingOfficer || "-"} />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm ring-1 ring-border">
        <CardContent className="space-y-4 pt-6">
          {!isAccountsUser && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="text-muted-foreground">
                {selectedRecipientIds.length === 0
                  ? "Select beneficiaries to review them in bulk."
                  : `${selectedRecipientIds.length} selected${
                      selectedPendingCount > 0 ? `, ${selectedPendingCount} still pending` : ""
                    }`}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={selectAllRecipients}
                  disabled={recipients.length === 0 || isBusy}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={clearRecipientSelection}
                  disabled={selectedRecipientIds.length === 0 || isBusy}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => handleBulkReviewRecipients("approved")}
                  disabled={selectedRecipientIds.length === 0 || isBusy || !canManageRecipients(payment)}
                >
                  {isActionBusy("bulk-approved") ? (
                    <>
                      <PageLoader inline />
                      <span>Approving...</span>
                    </>
                  ) : (
                    "Bulk Approve"
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="cursor-pointer"
                  variant="destructive"
                  onClick={() => handleBulkReviewRecipients("disapproved")}
                  disabled={selectedRecipientIds.length === 0 || isBusy || !canManageRecipients(payment)}
                >
                  {isActionBusy("bulk-disapproved") ? (
                    <>
                      <PageLoader inline />
                      <span>Disapproving...</span>
                    </>
                  ) : (
                    "Bulk Disapprove"
                  )}
                </Button>
              </div>
            </div>
          )}

          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {recipients.length === 0 ? (
              <p className="text-sm text-muted-foreground">No beneficiaries added yet.</p>
            ) : (
              recipients.map((recipient) => (
                <div key={recipient.id} className="rounded-md border p-3">
                  <div className="flex items-start gap-3">
                    {!isAccountsUser && (
                      <Checkbox
                        checked={selectedRecipientIds.includes(recipient.id)}
                        onCheckedChange={() => toggleRecipientSelection(recipient.id)}
                        disabled={!canManageRecipients(payment) || isBusy}
                        className="mt-1"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => openStaffDetails(recipient)}
                        className="mb-2 cursor-pointer rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {(recipient.staff?.firstName || "") + " " + (recipient.staff?.lastName || "") || "Unknown Staff"}
                        {recipient.staff?.employeeId ? ` (${recipient.staff.employeeId})` : ""}
                      </button>
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
                            disabled={isAccountsUser || !canManageRecipients(payment) || isBusy}
                          />
                        </div>
                        {!isAccountsUser && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              className="cursor-pointer"
                              onClick={() => handleUpdateAmount(recipient)}
                              disabled={!canManageRecipients(payment) || isBusy}
                            >
                              {isActionBusy(`update-${recipient.id}`) ? (
                                <>
                                  <PageLoader inline />
                                  <span>Saving...</span>
                                </>
                              ) : (
                                "Save Amount"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="cursor-pointer"
                              variant="destructive"
                              onClick={() => handleRemoveRecipient(recipient.id)}
                              disabled={!canManageRecipients(payment) || isBusy}
                            >
                              {isActionBusy(`remove-${recipient.id}`) ? (
                                <>
                                  <PageLoader inline />
                                  <span>Removing...</span>
                                </>
                              ) : (
                                "Remove"
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            recipient.status === "approved"
                              ? "border-emerald-500 text-emerald-700"
                              : recipient.status === "disapproved"
                                ? "border-rose-500 text-rose-700"
                                : "border-amber-500 text-amber-700"
                          }
                        >
                          {toTitleCase(recipient.status)}
                        </Badge>
                        {!isAccountsUser && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              className="cursor-pointer"
                              onClick={() => handleReviewRecipient(recipient, "approved")}
                              disabled={!canManageRecipients(payment) || isBusy || recipient.status === "approved"}
                            >
                              {isActionBusy(`review-approved-${recipient.id}`) ? (
                                <>
                                  <PageLoader inline />
                                  <span>Approving...</span>
                                </>
                              ) : (
                                "Approve"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="cursor-pointer"
                              variant="outline"
                              onClick={() => handleReviewRecipient(recipient, "disapproved")}
                              disabled={
                                !canManageRecipients(payment) ||
                                isBusy ||
                                recipient.status === "disapproved"
                              }
                            >
                              {isActionBusy(`review-disapproved-${recipient.id}`) ? (
                                <>
                                  <PageLoader inline />
                                  <span>Disapproving...</span>
                                </>
                              ) : (
                                "Disapprove"
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Add Beneficiary</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Staff</Label>
                <Popover open={staffPickerOpen} onOpenChange={setStaffPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={staffPickerOpen}
                      className="w-full justify-between cursor-pointer"
                      disabled={staffLoading || !canManageRecipients(payment) || isBusy}
                    >
                      {selectedStaff
                        ? `${selectedStaff.firstName} ${selectedStaff.lastName} (${selectedStaff.employeeId})`
                        : staffLoading
                          ? "Loading staff..."
                          : "Search and select staff"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name, employee ID, or email" />
                      <CommandList>
                        <CommandEmpty>No matching staff.</CommandEmpty>
                        {availableStaff.map((member) => (
                          <CommandItem
                            key={member.id}
                            value={`${member.firstName} ${member.lastName} ${member.employeeId} ${member.email}`}
                            onSelect={() => {
                              setSelectedStaffId(member.id);
                              setStaffPickerOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedStaffId === member.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {member.firstName} {member.lastName} ({member.employeeId})
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input
                  value={newAmount}
                  onChange={(event) => setNewAmount(event.target.value)}
                  placeholder="0.00"
                  disabled={!canManageRecipients(payment) || isBusy}
                />
              </div>
            </div>
            <Button
              type="button"
              className="cursor-pointer"
              onClick={handleAddRecipient}
              disabled={!canManageRecipients(payment) || isBusy || !selectedStaffId || !newAmount}
            >
              {isActionBusy("add-recipient") ? (
                <>
                  <PageLoader inline />
                  <span>Adding...</span>
                </>
              ) : (
                "Add Beneficiary"
              )}
            </Button>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {!isAccountsUser && (
              <p className="text-xs text-muted-foreground">
                {approvalBlockReason || "All beneficiaries are reviewed and the batch is ready for approval."}
              </p>
            )}
            <div className="flex gap-2 sm:justify-end">
              {!isAccountsUser && (
                <Button
                  type="button"
                  className="cursor-pointer"
                  onClick={handleApproveBatch}
                  disabled={!payment || !allRecipientsReviewed || isBusy || payment.status !== "pending_approval"}
                >
                  {isActionBusy("approve-batch") ? (
                    <>
                      <PageLoader inline />
                      <span>Approving...</span>
                    </>
                  ) : (
                    "Approve"
                  )}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => navigate("/approvals")}
              >
                Back to Queue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedRecipientStaff)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRecipientStaff(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Staff Details</DialogTitle>
            <DialogDescription>Beneficiary profile summary.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              <Avatar className="size-68 border shadow-sm">
                <AvatarImage
                  src={selectedRecipientStaff?.imageUrl ?? ""}
                  alt={`${selectedRecipientStaff?.firstName ?? ""} ${selectedRecipientStaff?.lastName ?? ""}`.trim()}
                />
                <AvatarFallback>
                  {`${selectedRecipientStaff?.firstName?.[0] ?? ""}${selectedRecipientStaff?.lastName?.[0] ?? ""}`
                    .trim()
                    .toUpperCase() || "S"}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-3">
                <p className="text-base font-semibold">
                  {selectedRecipientStaff?.firstName} {selectedRecipientStaff?.lastName}
                </p>
                <div className="grid gap-3">
                  <DataLine label="Department" value={selectedRecipientStaff?.department || "-"} />
                  <DataLine label="Position" value={selectedRecipientStaff?.position || "-"} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => setSelectedRecipientStaff(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ShowView>
  );
};

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}