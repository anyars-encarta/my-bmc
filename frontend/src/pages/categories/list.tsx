import { useTable } from "@refinedev/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import React, { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

import { DeleteButton } from "@/components/refine-ui/buttons/delete";
import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ShowButton } from "@/components/refine-ui/buttons/show";
import { DataTable } from "@/components/refine-ui/data-table/data-table";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";

type Category = {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
};

export const CategoryList = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const columns = useMemo(() => {
    const columnHelper = createColumnHelper<Category>();

    return [
      columnHelper.accessor("id", {
        id: "id",
        header: "ID",
        enableSorting: false,
      }),
      columnHelper.accessor("name", {
        id: "name",
        header: "Category",
        enableSorting: true,
      }),
      columnHelper.accessor("description", {
        id: "description",
        header: "Description",
        cell: ({ row }) => row.original.description || "-",
      }),
      columnHelper.accessor("isActive", {
        id: "isActive",
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "outline"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex gap-2">
            <EditButton recordItemId={row.original.id} size="sm" />
            <ShowButton recordItemId={row.original.id} size="sm" />
            <DeleteButton recordItemId={row.original.id} size="sm" />
          </div>
        ),
        enableSorting: false,
        size: 290,
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
      <ListViewHeader title="Payment Categories" />
      <div className="relative w-full sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search categories by name, description, or status"
          className="pl-9"
        />
      </div>
      <DataTable table={table} />
    </ListView>
  );
};
