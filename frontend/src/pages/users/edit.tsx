import { useEffect } from "react";
import { useParams } from "react-router";

import PageLoader from "@/components/PageLoader";
import { InputPassword } from "@/components/refine-ui/form/input-password";
import {
  EditView,
  EditViewHeader,
} from "@/components/refine-ui/views/edit-view";
import UploadWidget from "@/components/upload-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { User } from "@/types";
import { editUserSchema, EditUserValues } from "@/validations";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  BaseRecord,
  HttpError,
  useBack,
  useGetIdentity,
  useOne,
} from "@refinedev/core";
import { useForm } from "@refinedev/react-hook-form";
import { SubmitHandler } from "react-hook-form";

const EditUser = () => {
  const back = useBack();
  const { id } = useParams();
  const userId = id ?? "";

  const { data: loggedInUser } = useGetIdentity<User>();

  const { query: userQuery } = useOne<User>({
    resource: "users",
    id: userId,
    queryOptions: {
      enabled: Boolean(userId),
    },
  });

  const form = useForm<BaseRecord, HttpError, EditUserValues>({
    resolver: zodResolver(editUserSchema),
    refineCoreProps: {
      resource: "users",
      action: "edit",
      id: userId,
    },
    defaultValues: {
      name: "",
      email: "",
      role: "accounts",
      status: "active",
      image: null,
      imageCldPubId: null,
      password: "",
      confirmPassword: "",
    },
  });

  const {
    refineCore: { onFinish },
    control,
    formState: { isSubmitting },
    getValues,
    handleSubmit,
    reset,
    setValue,
  } = form;

  useEffect(() => {
    const record = userQuery.data?.data;
    if (!record) return;

    reset({
      name: record.name,
      email: record.email,
      role: record.role as "admin" | "accounts",
      status: record.status,
      image: record.image ?? null,
      imageCldPubId: record.imageCldPubId ?? null,
      password: "",
      confirmPassword: "",
    });
  }, [reset, userQuery.data?.data]);

  const onSubmit: SubmitHandler<EditUserValues> = async (values) => {
    const password = values.password?.trim() || undefined;

    await onFinish({
      name: values.name.trim(),
      email: values.email.trim().toLowerCase(),
      role: values.role,
      status: values.status,
      image: values.image ?? null,
      imageCldPubId: values.imageCldPubId ?? null,
      ...(password ? { password } : {}),
    });
  };

  if (userQuery.isLoading) {
    return (
      <EditView className="space-y-4">
        <EditViewHeader title="Edit User" />
        <PageLoader />
      </EditView>
    );
  }

  if (!userQuery.data?.data) {
    return (
      <EditView className="space-y-4">
        <EditViewHeader title="Edit User" />
        <p className="text-sm text-destructive">Failed to load user details.</p>
        <Button onClick={back} variant="outline" type="button">
          Go Back
        </Button>
      </EditView>
    );
  }

  return (
    <EditView className="space-y-4">
      <EditViewHeader title="Edit User" />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Account details</CardTitle>
          <CardDescription>
            Update identity, permissions, profile image, and password settings.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-5 md:grid-cols-2">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Name <span className="text-orange-600">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Full name"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Email <span className="text-orange-600">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="Email address"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {loggedInUser?.id !== userId && (
                <div className="grid gap-5 md:grid-cols-2">
                  <FormField
                    control={control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Role <span className="text-orange-600">*</span>
                        </FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="accounts">Accounts</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Account Status <span className="text-orange-600">*</span>
                        </FormLabel>
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select account status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              <FormField
                control={control}
                name="image"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Profile Photo</FormLabel>
                    <FormControl>
                      <UploadWidget
                        value={
                          field.value
                            ? {
                                url: field.value,
                                publicId: getValues("imageCldPubId") ?? "",
                              }
                            : null
                        }
                        onChange={(value) => {
                          field.onChange(value?.url ?? null);
                          setValue("imageCldPubId", value?.publicId ?? null, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-5 md:grid-cols-2">
                <FormField
                  control={control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <InputPassword
                          placeholder="Leave blank to keep current password"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <InputPassword
                          placeholder="Repeat new password"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="cursor-pointer"
                >
                  {isSubmitting ? (
                    <span className="inline-flex items-center gap-2">
                      <PageLoader />
                      Saving...
                    </span>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </EditView>
  );
};

export default EditUser;
