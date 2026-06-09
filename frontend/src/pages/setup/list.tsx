import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import type { SetupRecord } from "@/types/domain";
import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";

export const SetupList = () => {
  const columns = useMemo(() => {
    const helper = createColumnHelper<SetupRecord>();

    return [
      helper.accessor("facilityName", {
        id: "facilityName",
        header: "Facility Name",
      }),
      helper.accessor("facilityCode", {
        id: "facilityCode",
        header: "Facility Code",
      }),
      helper.accessor("telephone", {
        id: "telephone",
        header: "Telephone",
        cell: ({ row }) => row.original.telephone || "-",
      }),
      helper.accessor("email", {
        id: "email",
        header: "Email",
        cell: ({ row }) => row.original.email || "-",
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
      resource: "setup",
      syncWithLocation: true,
    },
  });

  const recordCount = table.refineCore.tableQuery.data?.data?.length ?? 0;

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Facility Setup" canCreate={recordCount === 0} />
      <DataTable table={table} />
    </ListView>
  );
};
