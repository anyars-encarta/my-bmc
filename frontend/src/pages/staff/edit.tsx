import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { SubmitHandler } from "react-hook-form";
import { BaseRecord, HttpError, useGetIdentity, useNotification, useOne } from "@refinedev/core";
import { useForm } from "@refinedev/react-hook-form";
import { toast } from "sonner";

import { staffCategoryOptions, staffStatusOptions, scheduleModeOptions } from "@/constants/options";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EditView, EditViewHeader } from "@/components/refine-ui/views/edit-view";
import PageLoader from "@/components/PageLoader";
import UploadWidget from "@/components/upload-widget";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import { fetchFacilityLocalDate } from "@/lib/facility-clock";
import { fetchStaffLoginAccounts, type StaffLoginAccount } from "@/lib/staff-login-users";
import type {
  JobRoleRecord,
  OrgUnitRecord,
  ShiftTypeRecord,
  StaffCategory,
  ScheduleMode,
  StaffRecord,
  StaffStatus,
} from "@/types/domain";
import type { UploadWidgetValue } from "@/types";

type StaffEditValues = {
  firstName: string;
  lastName: string;
  imageUrl?: string;
  email: string;
  employeeId: string;
  userId?: string | null;
  momoNumber: string;
  momoName?: string;
  department?: string;
  position?: string;
  phone?: string;
  staffCategory: StaffCategory;
  scheduleMode: ScheduleMode;
  defaultShiftTypeId?: string | null;
  jobRoleId?: string | null;
  badgeNumber?: string | null;
  hireDate?: string;
  terminationDate?: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

const requestWorkflow = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${apiBase}/v1/${path}`, {
    ...init,
    credentials: "include",
    headers: createAuthHeaders(init?.headers),
  });
  const payload = (await response.json()) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "The request failed.");
  }
  return payload;
};

export const StaffEdit = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const staffId = id ?? "";
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<{ role?: string; roles?: string[] }>();
  const roles = identity?.roles ?? (identity?.role ? [identity.role] : []);
  const canManageStaffWorkflows = roles.some((role) =>
    ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"].includes(role),
  );
  const [orgUnits, setOrgUnits] = useState<OrgUnitRecord[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRoleRecord[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftTypeRecord[]>([]);
  const [loginAccounts, setLoginAccounts] = useState<StaffLoginAccount[]>([]);
  const [statusValue, setStatusValue] = useState<StaffStatus | "">("");
  const [statusReason, setStatusReason] = useState("");
  const [statusSaving, setStatusSaving] = useState(false);
  const [pendingOrgUnitId, setPendingOrgUnitId] = useState("");
  const [facilityDate, setFacilityDate] = useState("");
  const [transferEffectiveFrom, setTransferEffectiveFrom] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const hydratedStaffId = useRef("");
  const { query: staffQuery } = useOne<StaffRecord>({
    resource: "staff",
    id: staffId,
    queryOptions: { enabled: Boolean(staffId) },
  });
  const record = staffQuery.data?.data;

  const form = useForm<BaseRecord, HttpError, StaffEditValues>({
    refineCoreProps: {
      resource: "staff",
      action: "edit",
      id: staffId,
    },
    defaultValues: {
      firstName: "",
      lastName: "",
      imageUrl: "",
      email: "",
      employeeId: "",
      userId: "",
      momoNumber: "",
      momoName: "",
      department: "",
      position: "",
      phone: "",
      staffCategory: "NON_CLINICAL",
      scheduleMode: "FIXED_WEEKDAY",
      defaultShiftTypeId: "",
      jobRoleId: "",
      badgeNumber: "",
      hireDate: "",
      terminationDate: "",
    },
  });

  const {
    refineCore: { onFinish },
    formState: { isSubmitting },
    watch,
    reset,
  } = form;

  const selectedCategory = watch("staffCategory");

  useEffect(() => {
    const fetchPaged = async <T,>(resourcePath: string) => {
      const records: T[] = [];
      let page = 1;
      while (true) {
        const response = await fetch(`${apiBase}/v1/${resourcePath}?page=${page}&limit=200`, {
          credentials: "include",
          headers: createAuthHeaders(),
        });
        if (!response.ok) {
          throw new Error(`Failed to load ${resourcePath}: ${response.status}`);
        }

        const payload = (await response.json()) as {
          data?: T[];
          pagination?: { hasMore?: boolean };
        };

        records.push(...(payload.data ?? []));
        if (!payload.pagination?.hasMore) {
          break;
        }
        page += 1;
      }
      return records;
    };

    const loadReferences = async () => {
      try {
        const [allOrgUnits, allJobRoles, allShiftTypes] = await Promise.all([
          fetchPaged<OrgUnitRecord>("org-units"),
          fetchPaged<JobRoleRecord>("job-roles"),
          fetchPaged<ShiftTypeRecord>("shift-types"),
        ]);

        setOrgUnits(allOrgUnits);
        setJobRoles(allJobRoles);
        setShiftTypes(allShiftTypes);
      } catch (error) {
        notify?.({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load staff reference data.",
        });
      }
    };

    const loadLoginAccounts = async () => {
      try {
        setLoginAccounts(await fetchStaffLoginAccounts(staffId));
      } catch (error) {
        notify?.({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load eligible login accounts.",
        });
      }
    };

    loadReferences();
    loadLoginAccounts();
  }, [notify, staffId]);

  useEffect(() => {
    fetchFacilityLocalDate()
      .then((date) => {
        setFacilityDate(date);
        setTransferEffectiveFrom(date);
      })
      .catch((error) => {
        notify?.({
          type: "error",
          message: error instanceof Error ? error.message : "Failed to load the facility date.",
        });
      });
  }, [notify]);

  useEffect(() => {
    if (!record || hydratedStaffId.current === record.id) return;

    hydratedStaffId.current = record.id;
    reset({
      firstName: record.firstName ?? "",
      lastName: record.lastName ?? "",
      imageUrl: record.imageUrl ?? "",
      email: record.email ?? "",
      employeeId: record.employeeId ?? "",
      userId: record.userId ?? "",
      momoNumber: record.momoNumber ?? "",
      momoName: record.momoName ?? "",
      department: record.department ?? "",
      position: record.position ?? "",
      phone: record.phone ?? "",
      staffCategory: record.staffCategory ?? "NON_CLINICAL",
      scheduleMode: record.scheduleMode ?? "FIXED_WEEKDAY",
      defaultShiftTypeId: record.defaultShiftTypeId ?? "",
      jobRoleId: record.jobRoleId ?? "",
      badgeNumber: record.badgeNumber ?? "",
      hireDate: record.hireDate?.slice(0, 10) ?? "",
      terminationDate: record.terminationDate?.slice(0, 10) ?? "",
    });
    setStatusValue(record.status);
    setPendingOrgUnitId(record.orgUnitId ?? "");
  }, [record, reset]);

  const filteredJobRoles = jobRoles.filter(
    (role) => role.staffCategory === selectedCategory || role.id === record?.jobRoleId,
  );
  const jobRoleOptions = [
    ...filteredJobRoles.map((option) => ({ value: option.id, label: option.name })),
    ...(record?.jobRoleId && !jobRoles.some((option) => option.id === record.jobRoleId)
      ? [{ value: record.jobRoleId, label: "Current job role unavailable" }]
      : []),
  ];
  const shiftTypeOptions = [
    ...shiftTypes.map((option) => ({
      value: option.id,
      label: `${option.code} — ${option.name}`,
    })),
    ...(record?.defaultShiftTypeId && !shiftTypes.some((option) => option.id === record.defaultShiftTypeId)
      ? [{ value: record.defaultShiftTypeId, label: "Current shift type unavailable" }]
      : []),
  ];
  const unitOptions = [
    {
      value: "__none__",
      label: record?.orgUnitId ? "Choose an org unit" : "Unassigned",
    },
    ...orgUnits
      .filter((unit) => unit.active || unit.id === record?.orgUnitId)
      .map((unit) => ({ value: unit.id, label: `${unit.name} (${unit.code})` })),
    ...(record?.orgUnitId && !orgUnits.some((unit) => unit.id === record.orgUnitId)
      ? [{ value: record.orgUnitId, label: "Current org unit unavailable" }]
      : []),
  ];
  const currentUserId = record?.userId;
  const loginAccountOptions = [
    { value: "__none__", label: "No linked login account" },
    ...loginAccounts.map((account) => ({
      value: account.id,
      label: `${account.name} — ${account.email}${account.status === "inactive" ? " (inactive)" : ""}`,
      keywords: `${account.name} ${account.email}`,
    })),
    ...(currentUserId && !loginAccounts.some((account) => account.id === currentUserId)
      ? [{ value: currentUserId, label: "Current linked login unavailable" }]
      : []),
  ];

  const updateStatus = async () => {
    if (!record || !statusValue || statusValue === record.status) return;
    if (!statusReason.trim()) {
      notify?.({ type: "error", message: "A reason is required to change staff status." });
      return;
    }

    const action = statusValue === "inactive" ? "deactivate" : "reactivate";
    try {
      setStatusSaving(true);
      const payload = await requestWorkflow<{
        data?: { linkedUserReactivated?: boolean };
        warnings?: string[];
      }>(`staff/${record.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason: statusReason.trim() }),
      });
      const nextStatus = statusValue;
      setStatusReason("");
      await staffQuery.refetch();
      setStatusValue(nextStatus);
      const linkedLoginNote =
        action === "reactivate" &&
        record.userId &&
        payload.data?.linkedUserReactivated === false
          ? " The linked login remains inactive because it was not active before deactivation."
          : "";
      payload.warnings?.forEach((warning) => toast.warning(warning));
      if (!payload.warnings?.length) {
        notify?.({
          type: "success",
          message: `Staff status updated to ${nextStatus}.${linkedLoginNote}`,
        });
      }
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to update staff status.",
      });
    } finally {
      setStatusSaving(false);
    }
  };

  const createTransferDraft = async () => {
    if (
      !record ||
      !record.orgUnitId ||
      !pendingOrgUnitId ||
      pendingOrgUnitId === record.orgUnitId ||
      record.status !== "active" ||
      !facilityDate ||
      !transferEffectiveFrom ||
      transferEffectiveFrom < facilityDate
    ) {
      return;
    }

    try {
      setTransferSaving(true);
      await requestWorkflow<{ data?: { id: string } }>("transfer-batches", {
        method: "POST",
        body: JSON.stringify({
          title: `Staff transfer for ${record.firstName} ${record.lastName}`,
          effectiveFrom: transferEffectiveFrom,
          items: [{ staffId: record.id, toUnitId: pendingOrgUnitId, reason: "TRANSFER" }],
        }),
      });
      setPendingOrgUnitId(record.orgUnitId);
      notify?.({
        type: "success",
        message: "Transfer draft created. Preview, approve, and apply it from Transfers.",
      });
    } catch (error) {
      notify?.({
        type: "error",
        message: error instanceof Error ? error.message : "Failed to create a transfer draft.",
      });
    } finally {
      setTransferSaving(false);
    }
  };

  const onSubmit: SubmitHandler<StaffEditValues> = async (values) => {
    await onFinish({
      ...values,
      userId: values.userId || null,
      defaultShiftTypeId: values.defaultShiftTypeId || null,
      jobRoleId: values.jobRoleId || null,
      badgeNumber: values.badgeNumber || null,
      hireDate: values.hireDate || undefined,
      terminationDate: values.terminationDate || undefined,
      department: values.department || undefined,
    });
  };

  if (staffQuery.isLoading) {
    return (
      <EditView className="space-y-4">
        <EditViewHeader title="Edit Staff Record" />
        <PageLoader />
      </EditView>
    );
  }

  if (!record) {
    return (
      <EditView className="space-y-4">
        <EditViewHeader title="Edit Staff Record" />
        <p className="text-sm text-destructive">Failed to load staff details.</p>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </EditView>
    );
  }

  const currentOrgUnit = orgUnits.find((unit) => unit.id === record.orgUnitId);

  return (
    <EditView className="space-y-4">
      <EditViewHeader title="Edit Staff Record" />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 rounded-lg border border-border bg-card p-6 md:grid-cols-2"
        >
          <TextField form={form} name="firstName" label="First Name" />
          <TextField form={form} name="lastName" label="Last Name" />

          <FormField
            control={form.control}
            name="imageUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Profile Photo</FormLabel>
                <FormControl>
                  <UploadWidget
                    value={field.value ? ({ url: field.value } as UploadWidgetValue) : null}
                    onChange={(nextValue) => field.onChange(nextValue?.url ?? "")}
                    folder="staff"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="employeeId" label="Employee ID" />
          <FormField
            control={form.control}
            name="userId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Linked Login Account (optional)</FormLabel>
                <FormControl>
                  <SearchableSelect
                    value={field.value || "__none__"}
                    onValueChange={(value) => field.onChange(value === "__none__" ? "" : value)}
                    options={loginAccountOptions}
                    placeholder="Select a login account"
                    searchPlaceholder="Search by name or email..."
                    emptyMessage="No eligible login accounts found."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <TextField form={form} name="momoNumber" label="MoMo Number" />
          <TextField form={form} name="momoName" label="MoMo Name" />
          <TextField form={form} name="phone" label="Phone" />
          <TextField form={form} name="position" label="Position" />
          <TextField form={form} name="department" label="Legacy Department (for migration reports)" required={false} />
          <TextField form={form} name="badgeNumber" label="Badge Number" required={false} />
          <TextField form={form} name="hireDate" label="Hire Date" type="date" required={false} />
          <TextField form={form} name="terminationDate" label="Termination Date" type="date" required={false} />
          {canManageStaffWorkflows ? (
            <div className="space-y-3 rounded-md border p-4">
              <div className="space-y-1.5">
                <Label htmlFor="staff-status">Status</Label>
                <Select
                  value={statusValue || record.status}
                  onValueChange={(value) => setStatusValue(value as StaffStatus)}
                >
                  <SelectTrigger id="staff-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {staffStatusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                placeholder={statusValue === "active" ? "Reason for reactivation" : "Reason for deactivation"}
                aria-label={statusValue === "active" ? "Reactivation reason" : "Deactivation reason"}
                maxLength={500}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void updateStatus()}
                disabled={
                  statusSaving ||
                  !statusValue ||
                  statusValue === record.status ||
                  !statusReason.trim()
                }
                className="cursor-pointer"
              >
                {statusSaving ? "Updating status..." : "Update Status"}
              </Button>
            </div>
          ) : null}

          <SelectField
            form={form}
            name="staffCategory"
            label="Staff Category"
            options={staffCategoryOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
          <SelectField
            form={form}
            name="scheduleMode"
            label="Schedule Mode"
            options={scheduleModeOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
          {canManageStaffWorkflows && record.orgUnitId ? <div className="space-y-3 rounded-md border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-current-org-unit">Current Org Unit</Label>
              <SearchableSelect
                value={pendingOrgUnitId || "__none__"}
                onValueChange={(value) =>
                  setPendingOrgUnitId(value === "__none__" ? "" : value)
                }
                options={unitOptions}
                placeholder="Choose an org unit"
                searchPlaceholder="Search org units..."
                emptyMessage="No matching org units."
                aria-label="Current Org Unit"
                id="staff-current-org-unit"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-effective-from">Transfer effective from</Label>
              <Input
                id="transfer-effective-from"
                type="date"
                min={facilityDate}
                value={transferEffectiveFrom}
                disabled={!facilityDate}
                onChange={(event) => setTransferEffectiveFrom(event.target.value)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              A unit change creates a transfer draft. The current unit changes only after the draft is approved and applied.
              {currentOrgUnit ? ` Current unit: ${currentOrgUnit.name} (${currentOrgUnit.code}).` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void createTransferDraft()}
                disabled={
                  transferSaving ||
                  !record.orgUnitId ||
                  record.status !== "active" ||
                  !pendingOrgUnitId ||
                  pendingOrgUnitId === record.orgUnitId ||
                  !facilityDate ||
                  !transferEffectiveFrom ||
                  transferEffectiveFrom < facilityDate
                }
                className="cursor-pointer"
              >
                {transferSaving ? "Creating draft..." : "Create Transfer Draft"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/transfers")}
                className="cursor-pointer"
              >
                Review Transfers
              </Button>
            </div>
          </div> : canManageStaffWorkflows ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">
              This staff member has no current org unit, so a transfer draft cannot be created.
            </p>
          ) : null}
          <SelectField
            form={form}
            name="jobRoleId"
            label="Job Role"
            required={false}
            options={jobRoleOptions}
          />
          <SelectField
            form={form}
            name="defaultShiftTypeId"
            label="Default Shift Type"
            required={false}
            options={shiftTypeOptions}
          />

          <div className="md:col-span-2 flex gap-2">
            <Button type="submit" className="cursor-pointer" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <PageLoader inline />
                  Saving...
                </span>
              ) : (
                "Save Staff"
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </EditView>
  );
};

type TextFieldProps = {
  form: ReturnType<typeof useForm<BaseRecord, HttpError, StaffEditValues>>;
  name: keyof StaffEditValues;
  label: string;
  type?: string;
  required?: boolean;
};

function TextField({ form, name, label, type = "text", required = true }: TextFieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      rules={required ? { required: `${label} is required` } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value || ""}
              type={type}
              placeholder={`Enter ${label.toLowerCase()}`}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

type SelectFieldProps = {
  form: ReturnType<typeof useForm<BaseRecord, HttpError, StaffEditValues>>;
  name: keyof StaffEditValues;
  label: string;
  options: Array<{ value: string; label: string }>;
  required?: boolean;
};

function SelectField({ form, name, label, options, required = true }: SelectFieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      rules={required ? { required: `${label} is required` } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select
            onValueChange={(value) => field.onChange(value === "__none__" ? "" : value)}
            value={(field.value as string | undefined) || "__none__"}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {!required ? <SelectItem value="__none__">None</SelectItem> : null}
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
