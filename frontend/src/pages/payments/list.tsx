import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { PaymentRecord } from "@/types/domain";
import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { useMemo } from "react";

export const PaymentList = () => {
  const columns = useMemo(() => {
    const helper = createColumnHelper<PaymentRecord>();

    return [
      helper.accessor("title", {
        id: "title",
        header: "Payment",
      }),
      helper.accessor("categoryId", {
        id: "category",
        header: "Category",
      }),
      helper.accessor("totalAmount", {
        id: "totalAmount",
        header: "Total",
        cell: ({ row }) => formatCurrency(row.original.totalAmount),
      }),
      helper.accessor("status", {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={paymentStatusTone(row.original.status)}
          >
            {toTitleCase(row.original.status)}
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
      <ListViewHeader title="Payments" />
      <DataTable table={table} />
    </ListView>
  );
};
