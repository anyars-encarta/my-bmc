import { useMemo, useState } from "react";

import ActionButton from "@/components/actionButton";
import { CreateButton } from "@/components/refine-ui/buttons/create";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User } from "@/types";
import {
  HttpError,
  useDelete,
  useGetIdentity,
  useNotification,
  useUpdate,
} from "@refinedev/core";
import { useTable } from "@refinedev/react-table";
import { ColumnDef } from "@tanstack/react-table";
import { Loader2, Search } from "lucide-react";

const extractErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return fallback;
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

const ListUsers = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [userPendingDelete, setUserPendingDelete] = useState<User | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  const { open } = useNotification();
  const { data: loggedInUser } = useGetIdentity<User>();
  const { mutateAsync: deleteUser } = useDelete();
  const { mutateAsync: updateUser } = useUpdate();

  const filters = useMemo(() => {
    const values: Array<{
      field: string;
      operator: "contains" | "eq";
      value: string;
    }> = [];

    const normalizedSearch = searchQuery.trim();
    if (normalizedSearch) {
      values.push({
        field: "search",
        operator: "contains",
        value: normalizedSearch,
      });
    }

    if (selectedRole) {
      values.push({
        field: "role",
        operator: "eq",
        value: selectedRole,
      });
    }

    if (selectedStatus) {
      values.push({
        field: "status",
        operator: "eq",
        value: selectedStatus,
      });
    }

    return values;
  }, [searchQuery, selectedRole, selectedStatus]);

  const usersTable = useTable<User>({
    columns: useMemo<ColumnDef<User>[]>(
      () => [
        {
          id: "select",
          size: 48,
          header: ({ table }) => {
            const visibleRows = table.getRowModel().rows;
            const visibleIds = visibleRows.map((row) => row.original.id);
            const selectedVisibleCount = visibleIds.filter((id) =>
              selectedUserIds.includes(id),
            ).length;

            const allVisibleSelected =
              visibleIds.length > 0 &&
              selectedVisibleCount === visibleIds.length;
            const partiallySelected =
              selectedVisibleCount > 0 &&
              selectedVisibleCount < visibleIds.length;

            return (
              <Checkbox
                aria-label="Select all visible users"
                checked={
                  partiallySelected ? "indeterminate" : allVisibleSelected
                }
                onCheckedChange={(checked) => {
                  const shouldSelect =
                    checked === "indeterminate" ? true : Boolean(checked);

                  setSelectedUserIds((prev) => {
                    const current = new Set(prev);

                    if (shouldSelect) {
                      visibleIds.forEach((id) => {
                        current.add(id);
                      });
                    } else {
                      visibleIds.forEach((id) => {
                        current.delete(id);
                      });
                    }

                    return Array.from(current);
                  });
                }}
              />
            );
          },
          cell: ({ row }) => {
            const rowId = row.original.id;
            const isSelected = selectedUserIds.includes(rowId);

            return (
              <Checkbox
                aria-label={`Select ${row.original.name}`}
                checked={isSelected}
                onCheckedChange={(checked) => {
                  const shouldSelect =
                    checked === "indeterminate" ? true : Boolean(checked);

                  setSelectedUserIds((prev) => {
                    if (shouldSelect) {
                      if (prev.includes(rowId)) return prev;
                      return [...prev, rowId];
                    }

                    return prev.filter((id) => id !== rowId);
                  });
                }}
              />
            );
          },
        },
        {
          id: "name",
          accessorKey: "name",
          size: 230,
          header: () => <p className="column-title">User</p>,
          cell: ({ row }) => (
            <div className="flex items-center gap-3">
              {row.original.image ? (
                <img
                  src={row.original.image}
                  alt={row.original.name}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium uppercase">
                  {row.original.name?.charAt(0) ?? "?"}
                </div>
              )}
              <div>
                <p className="font-medium">{row.original.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.original.email}
                </p>
              </div>
            </div>
          ),
        },
        {
          id: "role",
          accessorKey: "role",
          size: 110,
          header: () => <p className="column-title">Role</p>,
          cell: ({ getValue }) => (
            <Badge
              variant={roleBadgeVariant(String(getValue() ?? ""))}
              className="capitalize"
            >
              {String(getValue() ?? "")}
            </Badge>
          ),
        },
        {
          id: "status",
          accessorKey: "status",
          size: 110,
          header: () => <p className="column-title">Status</p>,
          cell: ({ getValue }) => (
            <Badge
              variant={statusBadgeVariant(String(getValue() ?? ""))}
              className="capitalize"
            >
              {String(getValue() ?? "")}
            </Badge>
          ),
        },
        {
          id: "emailVerified",
          accessorKey: "emailVerified",
          size: 130,
          header: () => <p className="column-title">Email Verified</p>,
          cell: ({ getValue }) => {
            const verified = Boolean(getValue<boolean>());
            return (
              <Badge variant={verified ? "default" : "secondary"}>
                {verified ? "Verified" : "Unverified"}
              </Badge>
            );
          },
        },
        {
          id: "createdAt",
          accessorKey: "createdAt",
          size: 130,
          header: () => <p className="column-title">Joined</p>,
          cell: ({ getValue }) => (
            <span className="text-muted-foreground text-sm">
              {new Date(getValue<string>()).toLocaleDateString()}
            </span>
          ),
        },
        {
          id: "actions",
          size: 170,
          header: () => <p className="column-title">Actions</p>,
          cell: ({ row }) => (
            <div className="flex items-center gap-2">
              <ShowButton
                resource="users"
                recordItemId={row.original.id}
                variant="outline"
                size="sm"
              >
                <ActionButton type="view" />
              </ShowButton>
              {row.original.id !== loggedInUser?.id && (
                <>
                  <EditButton
                    resource="users"
                    recordItemId={row.original.id}
                    variant="outline"
                    size="sm"
                  >
                    <ActionButton type="update" />
                  </EditButton>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="cursor-pointer"
                    onClick={() => setUserPendingDelete(row.original)}
                  >
                    <ActionButton type="delete" />
                  </Button>
                </>
              )}
            </div>
          ),
        },
      ],
      [loggedInUser?.id, selectedUserIds],
    ),
    refineCoreProps: {
      resource: "users",
      pagination: { pageSize: 10, mode: "server" },
      filters: {
        permanent: [...filters],
      },
      sorters: {
        initial: [{ field: "createdAt", order: "desc" }],
      },
    },
  });

  const handleConfirmDelete = async () => {
    if (!userPendingDelete || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteUser(
        {
          resource: "users",
          id: userPendingDelete.id,
          successNotification: false,
          errorNotification: false,
        },
        {
          onSuccess: () => {
            setUserPendingDelete(null);
          },
        },
      );

      open?.({
        type: "success",
        message: "User deleted",
        description: `"${userPendingDelete.name}" was deleted successfully.`,
      });
    } catch (error) {
      const statusCode =
        error && typeof error === "object" && "statusCode" in error
          ? Number((error as HttpError).statusCode)
          : undefined;
      const reason = extractErrorMessage(error, "Could not delete user.");

      if (statusCode === 409) {
        open?.({
          type: "error",
          message: "Cannot delete user",
          description: reason,
        });
      } else {
        open?.({
          type: "error",
          message: "Delete failed",
          description: reason,
        });
      }

      setUserPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const selectedUsers = usersTable.reactTable
    .getRowModel()
    .rows.map((row) => row.original)
    .filter((record) => selectedUserIds.includes(record.id));

  const handleBulkStatusUpdate = async (nextStatus: "active" | "inactive") => {
    if (!selectedUsers.length || isBulkUpdating) return;

    const usersToUpdate = selectedUsers.filter((record) => {
      if (record.status === nextStatus) return false;
      if (loggedInUser?.id === record.id) return false;
      return true;
    });

    if (!usersToUpdate.length) {
      open?.({
        type: "error",
        message: "No eligible users selected",
        description:
          "Selected users are already in that status or include your own account.",
      });
      return;
    }

    setIsBulkUpdating(true);
    try {
      const results = await Promise.allSettled(
        usersToUpdate.map((record) =>
          updateUser({
            resource: "users",
            id: record.id,
            values: {
              name: record.name,
              email: record.email,
              role: record.role,
              status: nextStatus,
              image: record.image ?? null,
              imageCldPubId: record.imageCldPubId ?? null,
            },
            successNotification: false,
            errorNotification: false,
          }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failedCount = results.length - successCount;

      if (successCount > 0) {
        open?.({
          type: "success",
          message: `${successCount} user${successCount > 1 ? "s" : ""} updated`,
          description: `Status set to ${nextStatus}.`,
        });
      }

      if (failedCount > 0) {
        open?.({
          type: "error",
          message: `${failedCount} update${failedCount > 1 ? "s" : ""} failed`,
          description: "Some selected users could not be updated.",
        });
      }

      setSelectedUserIds([]);
      await usersTable.refineCore.tableQuery?.refetch();
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const hasActiveFilters =
    Boolean(searchQuery.trim()) ||
    Boolean(selectedRole) ||
    Boolean(selectedStatus);

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Users" canCreate={false} />

      <Card>
        <CardHeader className="gap-4">
          <div className="space-y-1">
            <CardTitle>User Directory</CardTitle>
            <CardDescription>
              Manage system user accounts, access roles, and activation status.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_180px_180px] xl:flex-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by name or email"
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Select
                value={selectedRole || "all"}
                onValueChange={(value) =>
                  setSelectedRole(value === "all" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="accounts">Accounts</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={selectedStatus || "all"}
                onValueChange={(value) =>
                  setSelectedStatus(value === "all" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <CreateButton resource="users" />

              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => handleBulkStatusUpdate("active")}
                disabled={isBulkUpdating || selectedUsers.length === 0}
              >
                {isBulkUpdating ? "Updating..." : "Activate Selected"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => handleBulkStatusUpdate("inactive")}
                disabled={isBulkUpdating || selectedUsers.length === 0}
              >
                {isBulkUpdating ? "Updating..." : "Deactivate Selected"}
              </Button>

              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedRole("");
                    setSelectedStatus("");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <DataTable table={usersTable} />
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(userPendingDelete)}
        onOpenChange={(openState) => {
          if (!openState && !isDeleting) {
            setUserPendingDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {userPendingDelete
                ? `This will permanently delete "${userPendingDelete.name}" and all associated sessions.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await handleConfirmDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ListView>
  );
};

export default ListUsers;
