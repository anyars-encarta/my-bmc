import {
  ListView,
  ListViewHeader,
} from "@/components/refine-ui/views/list-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BACKEND_BASE_URL } from "@/constants";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { PaymentStatus, StaffRecord } from "@/types/domain";
import { useGetIdentity, useList, useNotification } from "@refinedev/core";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MomoBalanceResponse } from "@/types/momo";

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

export const ApprovalQueueList = () => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();
  const [searchQuery, setSearchQuery] = useState("");

  const { result: paymentsResult, query: paymentsQuery } =
    useList<ApprovalPayment>({
      resource: "payments",
      pagination: {
        pageSize: 200,
      },
    });

  const [selectedPayment, setSelectedPayment] =
    useState<ApprovalPayment | null>(null);
  const [recipients, setRecipients] = useState<ApprovalRecipient[]>([]);
  const [recipientAmounts, setRecipientAmounts] = useState<
    Record<string, string>
  >({});
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [staffPickerOpen, setStaffPickerOpen] = useState(false);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [selectedRecipientStaff, setSelectedRecipientStaff] =
    useState<StaffRecord | null>(null);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>(
    [],
  );
  const [staffLoading, setStaffLoading] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [momoBalance, setMomoBalance] = useState(0);
  const [momoCurrency, setMomoCurrency] = useState("GHS");
  const [isLoadingMomoBalance, setIsLoadingMomoBalance] = useState(true);
  const [momoBalanceError, setMomoBalanceError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const loadMomoBalance = async () => {
      setIsLoadingMomoBalance(true);
      setMomoBalanceError(null);

      try {
        const response = await fetch(`${apiBase}/momo/balance`, {
          credentials: "include",
          signal: controller.signal,
        });

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as MomoBalanceResponse) : {};

        if (!response.ok) {
          const message =
            payload.error || payload.message || "Unable to fetch MoMo balance.";
          throw new Error(message);
        }

        const availableBalance = Number(payload.data?.availableBalance ?? 0);
        setMomoBalance(
          Number.isFinite(availableBalance) ? availableBalance : 0,
        );
        setMomoCurrency(payload.data?.currency || "GHS");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setMomoBalanceError(
          error instanceof Error
            ? error.message
            : "Unable to fetch MoMo balance.",
        );
      } finally {
        setIsLoadingMomoBalance(false);
      }
    };

    void loadMomoBalance();

    return () => controller.abort();
  }, [apiBase]);

  const formattedMomoBalance = useMemo(() => {
    if (momoCurrency === "GHS") {
      return formatCurrency(momoBalance);
    }

    try {
      return new Intl.NumberFormat("en-GH", {
        style: "currency",
        currency: momoCurrency,
        minimumFractionDigits: 2,
      }).format(momoBalance);
    } catch {
      return `${momoCurrency} ${momoBalance.toFixed(2)}`;
    }
  }, [momoBalance, momoCurrency]);

  const queueItems = useMemo(() => {
    const payments = paymentsResult?.data ?? [];
    const identityTokens = [identity?.id, identity?.email, identity?.fullName]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase().trim());
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return payments
      .filter((payment) => {
        if (identity?.role === "admin" || identity?.role === "accounts") {
          return true;
        }

        if (!payment.approvingOfficer) {
          return false;
        }

        const approver = payment.approvingOfficer.toLowerCase().trim();
        return identityTokens.includes(approver);
      })
      .filter((payment) => {
        if (!normalizedSearch) {
          return true;
        }

        const searchableText = [
          payment.title,
          payment.category?.name,
          payment.status,
          payment.approvingOfficer,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
          .join(" ");

        return searchableText.includes(normalizedSearch);
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
  }, [
    identity?.email,
    identity?.fullName,
    identity?.id,
    identity?.role,
    paymentsResult?.data,
    searchQuery,
  ]);

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
    const run = async () => {
      try {
        setStaffLoading(true);
        const allStaff = await requestRecipients<StaffRecord[]>(
          `${apiBase}/staff`,
        );
        setStaff(allStaff);
      } catch (error) {
        notify?.({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load staff list.",
        });
      } finally {
        setStaffLoading(false);
      }
    };

    run();
  }, [notify]);

  useEffect(() => {
    const paymentId = selectedPayment?.id;
    if (!paymentId) return;

    const run = async () => {
      try {
        await refreshRecipients(paymentId);
      } catch (error) {
        notify?.({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load beneficiaries.",
        });
      }
    };

    run();
  }, [notify, selectedPayment?.id]);

  const openReview = async (payment: ApprovalPayment) => {
    setSelectedPayment(payment);
  };

  const isAccountsUser = identity?.role === "accounts";

  const canManageRecipients = (payment: ApprovalPayment | null) =>
    payment ? ["draft", "pending_approval"].includes(payment.status) : false;

  const allRecipientsReviewed =
    recipients.length > 0 &&
    recipients.every((recipient) => recipient.status !== "pending");

  const selectedRecipients = recipients.filter((recipient) =>
    selectedRecipientIds.includes(recipient.id),
  );
  const selectedPendingCount = selectedRecipients.filter(
    (recipient) => recipient.status === "pending",
  ).length;

  const approvalBlockReason = !selectedPayment
    ? ""
    : selectedPayment.status !== "pending_approval"
    ? "This batch can only be approved after submission."
    : recipients.length === 0
    ? "Add at least one beneficiary before approving."
    : recipients.some((recipient) => recipient.status === "pending")
    ? `${
        recipients.filter((recipient) => recipient.status === "pending").length
      } beneficiary${
        recipients.filter((recipient) => recipient.status === "pending")
          .length === 1
          ? " is"
          : "s are"
      } still awaiting review.`
    : "";

  const availableStaff = useMemo(() => {
    return staff.filter(
      (member) =>
        !recipients.some((recipient) => recipient.staffId === member.id),
    );
  }, [recipients, staff]);

  const selectedStaff = availableStaff.find(
    (member) => member.id === selectedStaffId,
  );

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

  const handleUpdateAmount = async (recipient: ApprovalRecipient) => {
    if (!selectedPayment) return;

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/recipients/${recipient.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            amount: recipientAmounts[recipient.id] || recipient.amount,
          }),
        },
      );
      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      notify?.({ type: "success", message: "Beneficiary amount updated." });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to update beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleReviewRecipient = async (
    recipient: ApprovalRecipient,
    status: "approved" | "disapproved",
  ) => {
    if (!selectedPayment) return;

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/recipients/${recipient.id}/review`,
        {
          method: "POST",
          body: JSON.stringify({ status }),
        },
      );
      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      notify?.({
        type: "success",
        message: `Beneficiary ${
          status === "approved" ? "approved" : "disapproved"
        }.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to review beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const toggleRecipientSelection = (recipientId: string) => {
    setSelectedRecipientIds((current) =>
      current.includes(recipientId)
        ? current.filter((id) => id !== recipientId)
        : [...current, recipientId],
    );
  };

  const selectAllRecipients = () => {
    setSelectedRecipientIds(recipients.map((recipient) => recipient.id));
  };

  const clearRecipientSelection = () => {
    setSelectedRecipientIds([]);
  };

  const handleBulkReviewRecipients = async (
    status: "approved" | "disapproved",
  ) => {
    if (!selectedPayment || selectedRecipientIds.length === 0) {
      return;
    }

    try {
      setIsBusy(true);
      for (const recipientId of selectedRecipientIds) {
        await requestRecipients(
          `${apiBase}/payments/${selectedPayment.id}/recipients/${recipientId}/review`,
          {
            method: "POST",
            body: JSON.stringify({ status }),
          },
        );
      }

      await refreshRecipients(selectedPayment.id);
      await paymentsQuery.refetch();
      setSelectedRecipientIds([]);
      notify?.({
        type: "success",
        message: `${selectedRecipientIds.length} beneficiary${
          selectedRecipientIds.length === 1 ? "" : "ies"
        } ${status === "approved" ? "reviewed" : "disapproved"}.`,
      });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to process selected beneficiaries.",
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
        message:
          error instanceof Error
            ? error.message
            : "Failed to remove beneficiary.",
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
        message:
          error instanceof Error ? error.message : "Failed to add beneficiary.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const handleApproveBatch = async () => {
    if (!selectedPayment || !allRecipientsReviewed) {
      return;
    }

    try {
      setIsBusy(true);
      await requestRecipients(
        `${apiBase}/payments/${selectedPayment.id}/approve`,
        {
          method: "POST",
        },
      );
      await paymentsQuery.refetch();
      setSelectedPayment(null);
      setRecipients([]);
      setRecipientAmounts({});
      setSelectedStaffId("");
      setStaffPickerOpen(false);
      setSelectedRecipientStaff(null);
      setNewAmount("");
      notify?.({ type: "success", message: "Payment batch approved." });
    } catch (error) {
      notify?.({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to approve batch.",
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <ListView className="space-y-4">
      <div className="flex items-center justify-between">
        <ListViewHeader title="Approval Queue" canCreate={false} />

        <div className="text-right">
          <p className="text-sm font-medium">
            MoMo Balance:{" "}
            {isLoadingMomoBalance ? "Loading..." : formattedMomoBalance}
          </p>
          {momoBalanceError && (
            <p className="text-xs text-destructive">{momoBalanceError}</p>
          )}
        </div>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search approvals by payment, category, status, or approver"
          className="pl-10"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>
      {paymentsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading approvals...</p>
      )}
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
                <p className="text-sm text-muted-foreground">
                  {item.categoryName}
                </p>
              </div>
              <Badge
                variant="outline"
                className={paymentStatusTone(item.status)}
              >
                {toTitleCase(item.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <DataLine
                  label="Recipients"
                  value={String(item.recipientsCount)}
                />
                <DataLine
                  label="Pending Verification"
                  value={String(item.pendingReviewCount)}
                />
                <DataLine
                  label="Amount"
                  value={formatCurrency(item.totalAmount)}
                />
                <DataLine label="Approver" value={item.approvingOfficer} />
              </div>
              <div className="flex gap-2">
                {identity?.role === "accounts" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openReview(item.raw)}
                  >
                    Manage Beneficiaries
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => openReview(item.raw)}>
                    Open Review
                  </Button>
                )}
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
            setStaffPickerOpen(false);
            setSelectedRecipientStaff(null);
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
              Approving officer can view, add, remove, and adjust individual
              beneficiary amounts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Total beneficiaries: {recipients.length}
            </div>

            {!isAccountsUser && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <div className="text-muted-foreground">
                  {selectedRecipientIds.length === 0
                    ? "Select beneficiaries to review them in bulk."
                    : `${selectedRecipientIds.length} selected${
                        selectedPendingCount > 0
                          ? `, ${selectedPendingCount} still pending`
                          : ""
                      }`}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={selectAllRecipients}
                    disabled={recipients.length === 0 || isBusy}
                  >
                    Select All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={clearRecipientSelection}
                    disabled={selectedRecipientIds.length === 0 || isBusy}
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleBulkReviewRecipients("approved")}
                    disabled={
                      selectedRecipientIds.length === 0 ||
                      isBusy ||
                      !canManageRecipients(selectedPayment)
                    }
                  >
                    Bulk Reviewed
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => handleBulkReviewRecipients("disapproved")}
                    disabled={
                      selectedRecipientIds.length === 0 ||
                      isBusy ||
                      !canManageRecipients(selectedPayment)
                    }
                  >
                    Bulk Disapproved
                  </Button>
                </div>
              </div>
            )}

            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {recipients.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No beneficiaries added yet.
                </p>
              ) : (
                recipients.map((recipient) => (
                  <div key={recipient.id} className="rounded-md border p-3">
                    <div className="flex items-start gap-3">
                      {!isAccountsUser && (
                        <Checkbox
                          checked={selectedRecipientIds.includes(recipient.id)}
                          onCheckedChange={() =>
                            toggleRecipientSelection(recipient.id)
                          }
                          disabled={
                            !canManageRecipients(selectedPayment) || isBusy
                          }
                          className="mt-1"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openStaffDetails(recipient)}
                          className="mb-2 text-sm font-medium text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                        >
                          {(recipient.staff?.firstName || "") +
                            " " +
                            (recipient.staff?.lastName || "") ||
                            "Unknown Staff"}
                          {recipient.staff?.employeeId
                            ? ` (${recipient.staff.employeeId})`
                            : ""}
                        </button>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="min-w-40 flex-1 space-y-1">
                            <Label htmlFor={`amount-${recipient.id}`}>
                              Amount
                            </Label>
                            <Input
                              id={`amount-${recipient.id}`}
                              value={
                                recipientAmounts[recipient.id] ??
                                recipient.amount
                              }
                              onChange={(event) => {
                                setRecipientAmounts((prev) => ({
                                  ...prev,
                                  [recipient.id]: event.target.value,
                                }));
                              }}
                              disabled={
                                isAccountsUser ||
                                !canManageRecipients(selectedPayment) ||
                                isBusy
                              }
                            />
                          </div>
                          {!isAccountsUser && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleUpdateAmount(recipient)}
                                disabled={
                                  !canManageRecipients(selectedPayment) ||
                                  isBusy
                                }
                              >
                                Save Amount
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  handleRemoveRecipient(recipient.id)
                                }
                                disabled={
                                  !canManageRecipients(selectedPayment) ||
                                  isBusy
                                }
                              >
                                Remove
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
                                variant="outline"
                                onClick={() =>
                                  handleReviewRecipient(recipient, "approved")
                                }
                                disabled={
                                  !canManageRecipients(selectedPayment) ||
                                  isBusy ||
                                  recipient.status === "approved"
                                }
                              >
                                Mark Reviewed
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleReviewRecipient(
                                    recipient,
                                    "disapproved",
                                  )
                                }
                                disabled={
                                  !canManageRecipients(selectedPayment) ||
                                  isBusy ||
                                  recipient.status === "disapproved"
                                }
                              >
                                Mark Disapproved
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

            <div className="rounded-md border p-3 space-y-3">
              <p className="text-sm font-medium">Add Beneficiary</p>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1 md:col-span-2">
                  <Label>Staff</Label>
                  <Popover
                    open={staffPickerOpen}
                    onOpenChange={setStaffPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={staffPickerOpen}
                        className="w-full justify-between"
                        disabled={
                          staffLoading ||
                          !canManageRecipients(selectedPayment) ||
                          isBusy
                        }
                      >
                        {selectedStaff
                          ? `${selectedStaff.firstName} ${selectedStaff.lastName} (${selectedStaff.employeeId})`
                          : staffLoading
                          ? "Loading staff..."
                          : "Search and select staff"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-(--radix-popover-trigger-width) p-0"
                      align="start"
                    >
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
                                  selectedStaffId === member.id
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              {member.firstName} {member.lastName} (
                              {member.employeeId})
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
                    disabled={!canManageRecipients(selectedPayment) || isBusy}
                  />
                </div>
              </div>
              <Button
                type="button"
                onClick={handleAddRecipient}
                disabled={
                  !canManageRecipients(selectedPayment) ||
                  isBusy ||
                  !selectedStaffId ||
                  !newAmount
                }
              >
                Add Beneficiary
              </Button>
            </div>
          </div>

          <DialogFooter>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {!isAccountsUser && (
                <p className="text-xs text-muted-foreground">
                  {approvalBlockReason ||
                    "All beneficiaries are reviewed and the batch is ready for approval."}
                </p>
              )}
              <div className="flex gap-2 sm:justify-end">
                {!isAccountsUser && (
                  <>
                    <Button
                      type="button"
                      onClick={handleApproveBatch}
                      disabled={
                        !selectedPayment ||
                        !allRecipientsReviewed ||
                        isBusy ||
                        selectedPayment?.status !== "pending_approval"
                      }
                    >
                      Approve Batch
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSelectedPayment(null)}
                    >
                      Close
                    </Button>
                  </>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  alt={`${selectedRecipientStaff?.firstName ?? ""} ${
                    selectedRecipientStaff?.lastName ?? ""
                  }`.trim()}
                />
                <AvatarFallback>
                  {`${selectedRecipientStaff?.firstName?.[0] ?? ""}${
                    selectedRecipientStaff?.lastName?.[0] ?? ""
                  }`
                    .trim()
                    .toUpperCase() || "S"}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-3">
                <p className="font-semibold text-base">
                  {selectedRecipientStaff?.firstName}{" "}
                  {selectedRecipientStaff?.lastName}
                </p>
                <div className="grid gap-3">
                  <DataLine
                    label="Department"
                    value={selectedRecipientStaff?.department || "-"}
                  />
                  <DataLine
                    label="Position"
                    value={selectedRecipientStaff?.position || "-"}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedRecipientStaff(null)}
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
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
