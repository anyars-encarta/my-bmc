import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SetupRecord } from "@/types/domain";
import { useShow } from "@refinedev/core";

export const SetupShow = () => {

  const { result: record } = useShow<SetupRecord>({});

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Facility Setup Details" canCreate={result > 0} />
      <Card>
        <CardHeader>
          <CardTitle>{record?.facilityName || "Facility Setup"}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DataLine label="Facility Code" value={record?.facilityCode} />
          <DataLine label="Telephone" value={record?.telephone} />
          <DataLine label="Email" value={record?.email} />
          <DataLine label="Logo URL" value={record?.logoUrl} />
          <DataLine label="Created At" value={record?.createdAt} />
          <DataLine label="Updated At" value={record?.updatedAt} />
          <div className="sm:col-span-2">
            <DataLine label="Address" value={record?.address} />
          </div>
        </CardContent>
      </Card>
    </ShowView>
  );
};

function DataLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium break-words">{value || "-"}</p>
    </div>
  );
}
