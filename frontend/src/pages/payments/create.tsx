import { paymentStatusOptions } from "@/constants/options";
import PageLoader from "@/components/PageLoader";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CreateView,
  CreateViewHeader,
} from "@/components/refine-ui/views/create-view";
import type { CategoryRecord } from "@/types/domain";
import { BaseRecord, HttpError, useList, useOne } from "@refinedev/core";
import { useForm } from "@refinedev/react-hook-form";
import { useEffect } from "react";
import { useNavigate } from "react-router";

type PaymentFormValues = {
  title: string;
  period?: string;
  categoryId: string;
  createdBy: string;
  approvingOfficer?: string;
  totalAmount: string;
  momoReferenceId?: string;
  description?: string;
  status: string;
};

export const PaymentCreate = () => {
  return <PaymentForm mode="create" />;
};

export const PaymentForm = ({
  mode,
  paymentId,
}: {
  mode: "create" | "edit";
  paymentId?: string;
}) => {
  const navigate = useNavigate();
  const { result: categoriesResult, query: categoriesQuery } =
    useList<CategoryRecord>({
      resource: "categories",
      pagination: {
        pageSize: 200,
      },
    });

  const categories = categoriesResult?.data ?? [];
  const categoriesLoading = categoriesQuery.isLoading;
  const { query: paymentQuery } = useOne<{ id: string } & PaymentFormValues>({
    resource: "payments",
    id: paymentId ?? "",
    queryOptions: {
      enabled: mode === "edit" && Boolean(paymentId),
    },
  });

  const form = useForm<BaseRecord, HttpError, PaymentFormValues>({
    refineCoreProps: {
      resource: "payments",
      action: mode,
      id: paymentId,
    },
    defaultValues: {
      title: "",
      period: "",
      categoryId: "",
      createdBy: "",
      approvingOfficer: "",
      totalAmount: "",
      momoReferenceId: "",
      description: "",
      status: "draft",
    },
  });

  const {
    refineCore: { onFinish },
    formState: { isSubmitting },
    reset,
  } = form;

  useEffect(() => {
    if (mode !== "edit") return;

    const record = paymentQuery.data?.data;
    if (!record) return;

    reset({
      title: record.title ?? "",
      period: record.period ?? "",
      categoryId: record.categoryId ?? "",
      createdBy: record.createdBy ?? "",
      approvingOfficer: record.approvingOfficer ?? "",
      totalAmount: record.totalAmount ?? "",
      momoReferenceId: record.momoReferenceId ?? "",
      description: record.description ?? "",
      status: record.status ?? "draft",
    });
  }, [mode, paymentQuery.data?.data, reset]);

  const onSubmit = (values: PaymentFormValues) => {
    onFinish({
      ...values,
      period: values.period || undefined,
      approvingOfficer: values.approvingOfficer || undefined,
      momoReferenceId: values.momoReferenceId || undefined,
      description: values.description || undefined,
    });
  };

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader
        title={
          mode === "create" ? "Create Payment Batch" : "Edit Payment Batch"
        }
      />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 rounded-lg border border-border bg-card p-6 md:grid-cols-2"
        >
          <TextField form={form} name="title" label="Payment Title" />
          <TextField form={form} name="period" label="Period" />
          <TextField form={form} name="createdBy" label="Payment Officer" />
          <TextField
            form={form}
            name="approvingOfficer"
            label="Approving Officer"
          />
          <TextField
            form={form}
            name="totalAmount"
            label="Total Amount"
            type="number"
          />
          <TextField
            form={form}
            name="momoReferenceId"
            label="MoMo Reference ID"
          />

          <FormField
            control={form.control}
            name="categoryId"
            rules={{ required: "Category is required" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <FormControl>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || ""}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          categoriesLoading
                            ? "Loading categories..."
                            : "Select category"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                          {!category.isActive ? " (Inactive)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value || ""}
                    placeholder="Describe this payment objective"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value || "draft"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {paymentStatusOptions.map((option) => (
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

          <div className="md:col-span-2 flex gap-2">
            <Button
              type="submit"
              className="cursor-pointer"
              {...form.saveButtonProps}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <PageLoader inline />
                  Saving...
                </span>
              ) : (
                "Save Payment"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </CreateView>
  );
};

type FieldProps = {
  form: ReturnType<typeof useForm<BaseRecord, HttpError, PaymentFormValues>>;
  name: keyof PaymentFormValues;
  label: string;
  type?: string;
};

function TextField({ form, name, label, type = "text" }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name={name}
      rules={{ required: `${label} is required` }}
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
