import { EditButton } from "@/components/refine-ui/buttons/edit";
import { ListView, ListViewHeader } from "@/components/refine-ui/views/list-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { SetupRecord } from "@/types/domain";
import { useList } from "@refinedev/core";
import { Building2 } from "lucide-react";

export const SetupShow = () => {
  const { result, query } = useList<SetupRecord>({
    resource: "setup",
    pagination: { pageSize: 1 },
  });

  const isLoading = query.isLoading;
  const record = result?.data?.[0];
  const hasRecord = !isLoading && !!record;

  if (isLoading) {
    return (
      <ListView className="space-y-4">
        <ListViewHeader title="Facility Setup" canCreate={false} />
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 pt-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </ListView>
    );
  }

  return (
    <ListView className="space-y-4">
      <ListViewHeader
        title="Facility Setup"
        canCreate={!hasRecord}
      />

      {!hasRecord ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="rounded-full bg-muted p-4">
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-lg">No setup record found</p>
              <p className="text-sm text-muted-foreground">
                Create your facility setup to get started.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {record.logoUrl ? (
                <img
                  src={record.logoUrl}
                  alt={record.facilityName}
                  className="h-14 w-14 rounded-md object-contain border border-border bg-white p-1"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-border bg-muted">
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div>
                <CardTitle className="text-xl">{record.facilityName}</CardTitle>
                <Badge variant="outline" className="mt-1 font-mono text-xs">
                  {record.facilityCode}
                </Badge>
              </div>
            </div>
            <EditButton recordItemId={record.id} resource="setup" variant="outline" />
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 pt-2">
            <DataLine label="Telephone" value={record.telephone} />
            <DataLine label="Email" value={record.email} />
            <div className="sm:col-span-2">
              <DataLine label="Address" value={record.address} />
            </div>
            {record.logoUrl && (
              <div className="sm:col-span-2">
                <DataLine label="Logo URL" value={record.logoUrl} />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </ListView>
  );
};

function DataLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium wrap-break-word">{value || "-"}</p>
    </div>
  );
}
