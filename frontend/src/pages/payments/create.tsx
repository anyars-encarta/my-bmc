import { paymentStatusOptions } from "@/constants/options";
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
import { CreateView, CreateViewHeader } from "@/components/refine-ui/views/create-view";
import { useForm } from "@refinedev/react-hook-form";
import { useNavigate } from "react-router";

export const PaymentCreate = () => {
  const navigate = useNavigate();
  const {
    refineCore: { onFinish },
    ...form
  } = useForm({
    refineCoreProps: {},
    defaultValues: {
      status: "draft",
    },
  });

  const onSubmit = (values: Record<string, string>) => {
    onFinish(values);
  };

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Create Payment Batch" />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 rounded-lg border border-border bg-card p-6 md:grid-cols-2"
        >
          <TextField form={form} name="title" label="Payment Title" />
          <TextField form={form} name="categoryId" label="Category ID" />
          <TextField form={form} name="createdBy" label="Payment Officer" />
          <TextField form={form} name="approvingOfficer" label="Approving Officer" />
          <TextField form={form} name="totalAmount" label="Total Amount" type="number" />
          <TextField form={form} name="momoReferenceId" label="MoMo Reference ID" />

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
                <Select onValueChange={field.onChange} value={field.value || "draft"}>
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
            <Button type="submit" {...form.saveButtonProps}>
              Save Payment
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

type FieldProps = {
  form: ReturnType<typeof useForm>;
  name: string;
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
            <Input {...field} value={field.value || ""} type={type} placeholder={`Enter ${label.toLowerCase()}`} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
