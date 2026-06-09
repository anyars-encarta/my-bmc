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
import { Textarea } from "@/components/ui/textarea";
import { EditView, EditViewHeader } from "@/components/refine-ui/views/edit-view";
import type { SetupRecord } from "@/types/domain";
import { useForm } from "@refinedev/react-hook-form";
import { useNavigate } from "react-router";

export const SetupEdit = () => {
  const navigate = useNavigate();
  const {
    refineCore: { onFinish },
    ...form
  } = useForm<SetupRecord>({
    refineCoreProps: {},
  });

  const onSubmit = (values: SetupRecord) => {
    onFinish(values);
  };

  return (
    <EditView className="space-y-4">
      <EditViewHeader title="Edit Facility Setup" />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 rounded-lg border border-border bg-card p-6 md:grid-cols-2"
        >
          <Field form={form} name="facilityName" label="Facility Name" required />
          <Field form={form} name="facilityCode" label="Facility Code" required />
          <Field form={form} name="telephone" label="Telephone" />
          <Field form={form} name="email" label="Email" type="email" />
          <Field form={form} name="logoUrl" label="Logo URL" />

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel>Address</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value || ""}
                    placeholder="Enter facility address"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="md:col-span-2 flex gap-2">
            <Button type="submit" {...form.saveButtonProps}>Update Setup</Button>
            <Button type="button" variant="outline" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </EditView>
  );
};

type FieldProps = {
  form: ReturnType<typeof useForm<SetupRecord>>;
  name: keyof SetupRecord;
  label: string;
  type?: string;
  required?: boolean;
};

function Field({ form, name, label, type = "text", required = false }: FieldProps) {
  return (
    <FormField
      control={form.control}
      name={name as string}
      rules={required ? { required: `${label} is required` } : undefined}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              value={(field.value as string) || ""}
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
