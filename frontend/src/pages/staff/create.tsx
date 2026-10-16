import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { SubmitHandler } from "react-hook-form";
import { BaseRecord, HttpError, useNotification } from "@refinedev/core";
import { useForm } from "@refinedev/react-hook-form";

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
import { CreateView, CreateViewHeader } from "@/components/refine-ui/views/create-view";
import PageLoader from "@/components/PageLoader";
import UploadWidget from "@/components/upload-widget";
import { BACKEND_BASE_URL } from "@/constants";
import { createAuthHeaders } from "@/providers/me";
import type { JobRoleRecord, OrgUnitRecord, ShiftTypeRecord, StaffCategory, ScheduleMode } from "@/types/domain";
import type { UploadWidgetValue } from "@/types";

type StaffCreateValues = {
  firstName: string;
  lastName: string;
  imageUrl?: string;
  email: string;
  employeeId: string;
  momoNumber: string;
  momoName?: string;
  department?: string;
  orgUnitId?: string;
  position?: string;
  phone?: string;
  status: string;
  staffCategory: StaffCategory;
  scheduleMode: ScheduleMode;
  defaultShiftTypeId?: string;
  jobRoleId?: string;
  badgeNumber?: string;
  hireDate?: string;
  terminationDate?: string;
  userId?: string;
};

const apiBase = BACKEND_BASE_URL.replace(/\/+$/, "");

export const StaffCreate = () => {
  const navigate = useNavigate();
  const { open: notify } = useNotification();
  const [orgUnits, setOrgUnits] = useState<OrgUnitRecord[]>([]);
  const [jobRoles, setJobRoles] = useState<JobRoleRecord[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftTypeRecord[]>([]);

  const form = useForm<BaseRecord, HttpError, StaffCreateValues>({
    refineCoreProps: {},
    defaultValues: {
      firstName: "",
      lastName: "",
      imageUrl: "",
      email: "",
      employeeId: "",
      momoNumber: "",
      momoName: "",
      department: "",
      orgUnitId: "",
      position: "",
      phone: "",
      status: "active",
      staffCategory: "NON_CLINICAL",
      scheduleMode: "FIXED_WEEKDAY",
      defaultShiftTypeId: "",
      jobRoleId: "",
      badgeNumber: "",
      hireDate: "",
      terminationDate: "",
      userId: "",
    },
  });

  const {
    refineCore: { onFinish },
    formState: { isSubmitting },
    watch,
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

    loadReferences();
  }, [notify]);

  const filteredJobRoles = jobRoles.filter((role) => role.staffCategory === selectedCategory);

  const onSubmit: SubmitHandler<StaffCreateValues> = (values) => {
    onFinish({
      ...values,
      orgUnitId: values.orgUnitId || undefined,
      defaultShiftTypeId: values.defaultShiftTypeId || undefined,
      jobRoleId: values.jobRoleId || undefined,
      badgeNumber: values.badgeNumber || undefined,
      hireDate: values.hireDate || undefined,
      terminationDate: values.terminationDate || undefined,
      userId: values.userId || undefined,
      department: values.department || undefined,
    });
  };

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Create Staff Record" />
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
          <TextField form={form} name="momoNumber" label="MoMo Number" />
          <TextField form={form} name="momoName" label="MoMo Name" />
          <TextField form={form} name="phone" label="Phone" />
          <TextField form={form} name="position" label="Position" />
          <TextField form={form} name="department" label="Legacy Department (for migration reports)" required={false} />
          <TextField form={form} name="badgeNumber" label="Badge Number" required={false} />
          <TextField form={form} name="hireDate" label="Hire Date" type="date" required={false} />
          <TextField form={form} name="terminationDate" label="Termination Date" type="date" required={false} />

          <SelectField
            form={form}
            name="status"
            label="Status"
            options={staffStatusOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
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
          <SelectField
            form={form}
            name="orgUnitId"
            label="Current Org Unit"
            required={false}
            options={orgUnits.map((option) => ({ value: option.id, label: `${option.name} (${option.code})` }))}
          />
          <SelectField
            form={form}
            name="jobRoleId"
            label="Job Role"
            required={false}
            options={filteredJobRoles.map((option) => ({ value: option.id, label: option.name }))}
          />
          <SelectField
            form={form}
            name="defaultShiftTypeId"
            label="Default Shift Type"
            required={false}
            options={shiftTypes.map((option) => ({ value: option.id, label: `${option.code} — ${option.name}` }))}
          />

          <div className="md:col-span-2 flex gap-2">
            <Button type="submit" className="cursor-pointer" {...form.saveButtonProps}>
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
    </CreateView>
  );
};

type TextFieldProps = {
  form: ReturnType<typeof useForm<BaseRecord, HttpError, StaffCreateValues>>;
  name: keyof StaffCreateValues;
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
  form: ReturnType<typeof useForm<BaseRecord, HttpError, StaffCreateValues>>;
  name: keyof StaffCreateValues;
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
