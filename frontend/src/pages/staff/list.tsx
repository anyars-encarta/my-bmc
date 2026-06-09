import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";
import type { StaffRecord } from "@/types/domain";

export const StaffList = () => {
  const columns = useMemo(() => {
    const helper = createColumnHelper<StaffRecord>();

    return [
      helper.accessor("employeeId", {
        id: "employeeId",
        header: "Employee ID",
      }),
      helper.accessor((row) => `${row.firstName} ${row.lastName}`, {
        id: "fullName",
        header: "Full Name",
      }),
      helper.accessor("email", {
        id: "email",
        header: "Email",
      }),
      helper.accessor("momoNumber", {
        id: "momoNumber",
        header: "MoMo Number",
      }),
      helper.accessor("status", {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.status === "active" ? "default" : "outline"}>
            {row.original.status}
          </Badge>
        ),
      }),
      helper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <EditButton recordItemId={row.original.id} size="sm" />
            <ShowButton recordItemId={row.original.id} size="sm" />
            <DeleteButton recordItemId={row.original.id} size="sm" />
          </div>
        ),
        size: 280,
      }),
    ];
  }, []);

  const table = useTable({
    columns,
    refineCoreProps: {
      syncWithLocation: true,
    },
  });

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Staff Directory" />
      <DataTable table={table} />
    </ListView>
  );
};
