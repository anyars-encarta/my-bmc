import { LogoUploader } from "@/components/setup/LogoUploader";
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
import { useController } from "react-hook-form";
import { useNavigate } from "react-router";

export const SetupEdit = () => {
  const navigate = useNavigate();
  const form = useForm<SetupRecord>({
    refineCoreProps: {},
  });

  const {
    refineCore: { onFinish },
  } = form;

  const { field: logoField } = useController({
    control: form.control as any,
    name: "logoUrl",
  });

  const onSubmit = (values: SetupRecord) => {
    onFinish(values);
  };

  return (
    <EditView className="space-y-4">
      <EditViewHeader title="Edit Facility Setup" />
      <Form {...(form as any)}>
      <form
        onSubmit={form.handleSubmit(onSubmit as any)}
        className="grid gap-4 rounded-lg border border-border bg-card p-6 md:grid-cols-2"
      >
        <Field control={form.control} name="facilityName" label="Facility Name" required />
        <Field control={form.control} name="facilityCode" label="Facility Code" required />
        <Field control={form.control} name="telephone" label="Telephone" />
        <Field control={form.control} name="email" label="Email" type="email" />

        <FormField
          control={form.control as any}
          name="address"
          render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={(field.value as string) || ""}
                  placeholder="Enter facility address"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="md:col-span-2">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">Facility Logo</label>
            <LogoUploader
              value={(logoField.value as string) || ""}
              onChange={logoField.onChange}
            />
          </div>
        </div>

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
  control: any;
  name: keyof SetupRecord;
  label: string;
  type?: string;
  required?: boolean;
};

function Field({ control, name, label, type = "text", required = false }: FieldProps) {
  return (
    <FormField
      control={control}
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
