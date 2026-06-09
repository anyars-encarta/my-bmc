import { staffStatusOptions } from "@/constants/options";
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
import { useForm } from "@refinedev/react-hook-form";
import { useNavigate } from "react-router";

export const StaffCreate = () => {
  const navigate = useNavigate();
  const {
    refineCore: { onFinish },
    ...form
  } = useForm({
    refineCoreProps: {},
    defaultValues: {
      status: "active",
    },
  });

  const onSubmit = (values: Record<string, string>) => {
    onFinish(values);
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
          <TextField form={form} name="email" label="Email" type="email" />
          <TextField form={form} name="employeeId" label="Employee ID" />
          <TextField form={form} name="momoNumber" label="MoMo Number" />
          <TextField form={form} name="momoName" label="MoMo Name" />
          <TextField form={form} name="department" label="Department" />
          <TextField form={form} name="position" label="Position" />
          <TextField form={form} name="phone" label="Phone" />

          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || "active"}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {staffStatusOptions.map((option) => (
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
              Save Staff
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
