import { useEffect } from "react";
import { useParams } from "react-router";

import PageLoader from "@/components/PageLoader";
import { Breadcrumb } from "@/components/refine-ui/layout/breadcrumb";
import { EditView } from "@/components/refine-ui/views/edit-view";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InputPassword } from "@/components/refine-ui/form/input-password";
import UploadWidget from "@/components/upload-widget";
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
import { Loader2 } from "lucide-react";
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
      role: "staff",
      status: "active",
      image: null,
      imageCldPubId: null,
      password: "",
      confirmPassword: "",
    },
  });

  const {
    refineCore: { onFinish },
    handleSubmit,
    formState: { isSubmitting },
    control,
    getValues,
    reset,
    setValue,
  } = form;

  useEffect(() => {
    const record = userQuery.data?.data;
    if (!record) return;
    reset({
      name: record.name,
      email: record.email,
      role: record.role as "admin" | "teacher" | "parent" | "staff",
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
      <EditView className="class-view">
        <Breadcrumb />
        <PageLoader />
      </EditView>
    );
  }

  if (!userQuery.data?.data) {
    return (
      <EditView className="class-view">
        <Breadcrumb />
        <p className="text-sm text-destructive">Failed to load user details.</p>
        <Button onClick={back} variant="outline" type="button">
          Go Back
        </Button>
      </EditView>
    );
  }

  return (
    <EditView className="class-view">
      <Breadcrumb />

      <h1 className="page-title">Edit User</h1>

      <div className="intro-row">
        <p>Update user account details below.</p>
        <Button onClick={back} className="cursor-pointer" type="button">
          Go Back
        </Button>
      </div>

      <Separator />

      <div className="my-4 flex items-center">
        <Card className="class-form-card w-full">
          <CardHeader className="relative z-10">
            <CardTitle className="text-2xl pb-0 font-bold">
              Update user details
            </CardTitle>
          </CardHeader>

          <Separator />

          <CardContent className="mt-7">
            <Form {...form}>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
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
                {loggedInUser?.id !== userId && (
                  <FormField
                    control={control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Role <span className="text-orange-600">*</span>
                        </FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select role" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="teacher">Teacher</SelectItem>
                            <SelectItem value="parent">Parent</SelectItem>
                            <SelectItem value="staff">Staff</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {loggedInUser?.id !== userId && (
                  <FormField
                    control={control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Account Status <span className="text-orange-600">*</span>
                        </FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
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

                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="cursor-pointer"
                  >
                    {isSubmitting ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
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
      </div>
    </EditView>
  );
};

export default EditUser;
