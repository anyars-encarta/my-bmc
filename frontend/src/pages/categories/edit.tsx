import { useForm } from "@refinedev/react-hook-form";
import { BaseRecord, HttpError } from "@refinedev/core";
import { SubmitHandler } from "react-hook-form";
import { useNavigate } from "react-router";

import {
  EditView,
  EditViewHeader,
} from "@/components/refine-ui/views/edit-view";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import PageLoader from "@/components/PageLoader";

type CategoryEditValues = {
  name: string;
  description?: string;
  isActive: boolean;
};

export const CategoryEdit = () => {
  const navigate = useNavigate();

  const form = useForm<BaseRecord, HttpError, CategoryEditValues>({
    refineCoreProps: {},
    defaultValues: {
      name: "",
      description: "",
      isActive: true,
    },
  });

  const {
    refineCore: { onFinish },
    formState: { isSubmitting },
  } = form;

  const onSubmit: SubmitHandler<CategoryEditValues> = (values) => {
    onFinish(values);
  };

  return (
    <EditView className="space-y-4">
      <EditViewHeader title="Edit Category" />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            rules={{ required: "Name is required" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value || ""}
                    placeholder="Enter category name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value || ""}
                    placeholder="Describe this category"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <FormLabel>Active Category</FormLabel>
                </div>
                <FormControl>
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <div className="flex gap-2">
            <Button
              type="submit"
              className="cursor-pointer"
              {...form.saveButtonProps}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <PageLoader inline />
                  Updating...
                </span>
              ) : (
                "Update Category"
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
    </EditView>
  );
};
