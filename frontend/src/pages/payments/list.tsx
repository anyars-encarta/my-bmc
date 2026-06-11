import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { CreateButton } from "@/components/refine-ui/buttons/create";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/currency";
import { paymentStatusTone, toTitleCase } from "@/lib/payment";
import type { PaymentRecord } from "@/types/domain";
import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export const PaymentList = () => {
  const [searchQuery, setSearchQuery] = useState("");

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
        cell: ({ row }) => row.original.category?.name || row.original.categoryId,
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

  const filters = useMemo(() => {
    const query = searchQuery.trim();

    return query
      ? [
          {
            field: "search",
            operator: "contains" as const,
            value: query,
          },
        ]
      : [];
  }, [searchQuery]);

  const table = useTable({
    columns,
    refineCoreProps: {
      syncWithLocation: true,
      filters: {
        permanent: filters,
      },
    },
  });

  const {
    refineCore: { setCurrentPage },
  } = table;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, setCurrentPage]);

  return (
    <ListView className="space-y-4">
      <ListViewHeader title="Payments" canCreate={false} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search payments by title, category, status, or officer"
            className="pl-9"
          />
        </div>
        <CreateButton resource="payments" />
      </div>
      <DataTable table={table} />
    </ListView>
  );
};
