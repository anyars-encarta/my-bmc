import { useParams } from "react-router";

import PageLoader from "@/components/PageLoader";
import {
  ShowView,
  ShowViewHeader,
} from "@/components/refine-ui/views/show-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { User } from "@/types";
import { useBack, useOne } from "@refinedev/core";
import {
  CalendarDays,
  CheckCircle2,
  Mail,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";

const formatDate = (value?: string | null) => {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const roleBadgeVariant = (
  role: string,
): "default" | "secondary" | "outline" => {
  if (role === "admin") return "default";
  if (role === "accounts") return "secondary";
  return "outline";
};

const statusBadgeVariant = (
  status: string,
): "default" | "secondary" | "outline" | "destructive" => {
  if (status === "active") return "default";
  if (status === "inactive") return "destructive";
  return "secondary";
};

const ShowUser = () => {
  const back = useBack();
  const { id } = useParams();
  const userId = id ?? "";

  const { query } = useOne<User>({
    resource: "users",
    id: userId,
    queryOptions: {
      enabled: Boolean(userId),
    },
  });

  const user = query.data?.data;
  const initials = user?.name
    ? user.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : "?";

  if (query.isLoading) {
    return (
      <ShowView className="space-y-4">
        <ShowViewHeader title="User Details" />
        <PageLoader />
      </ShowView>
    );
  }

  if (!user) {
    return (
      <ShowView className="space-y-4">
        <ShowViewHeader title="User Details" />
        <p className="text-sm text-destructive">Failed to load user details.</p>
        <Button onClick={back} variant="outline" type="button">
          Go Back
        </Button>
      </ShowView>
    );
  }

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="User Details" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="border-b">
            <CardTitle className="text-xl">Profile</CardTitle>
            <CardDescription>
              Core identity details and verification state.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-4">
              <Avatar className="size-16 border">
                <AvatarImage src={user.image ?? ""} alt={user.name} />
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-lg">{user.name}</p>
                <Badge
                  variant={roleBadgeVariant(user.role)}
                  className="capitalize mt-1"
                >
                  {user.role}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              {user.emailVerified ? (
                <>
                  <CheckCircle2 className="size-4 text-green-600" />
                  <span>Email verified</span>
                </>
              ) : (
                <>
                  <XCircle className="size-4 text-red-600" />
                  <span>Email not verified</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="text-xl">Account Details</CardTitle>
            <CardDescription>
              Role assignment, status, and lifecycle metadata for this user.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <UserRound className="size-4" />
                  {user.name}
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <Mail className="size-4" />
                  {user.email}
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Role</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4" />
                  <span className="capitalize">{user.role}</span>
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <Badge
                    variant={statusBadgeVariant(user.status)}
                    className="capitalize"
                  >
                    {user.status}
                  </Badge>
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Joined</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <CalendarDays className="size-4" />
                  {formatDate(user.createdAt)}
                </p>
              </div>

              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Last Updated</p>
                <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <CalendarDays className="size-4" />
                  {formatDate(user.updatedAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ShowView>
  );
};

export default ShowUser;
