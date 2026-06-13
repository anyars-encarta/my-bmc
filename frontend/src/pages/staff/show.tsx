import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useShow } from "@refinedev/core";
import type { StaffRecord } from "@/types/domain";

export const StaffShow = () => {
  const { result: record } = useShow<StaffRecord>({});

  const initials = `${record?.firstName?.[0] ?? ""}${record?.lastName?.[0] ?? ""}`
    .trim()
    .toUpperCase() || "S";

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Staff Profile" />
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-12 border">
              <AvatarImage src={record?.imageUrl ?? ""} alt={`${record?.firstName ?? ""} ${record?.lastName ?? ""}`.trim()} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <CardTitle>
              {record?.firstName} {record?.lastName}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <DataItem label="Employee ID" value={record?.employeeId} />
          <DataItem label="Email" value={record?.email} />
          <DataItem label="Department" value={record?.department} />
          <DataItem label="Position" value={record?.position} />
          <DataItem label="Phone" value={record?.phone} />
          <DataItem label="MoMo Number" value={record?.momoNumber} />
          <DataItem label="MoMo Name" value={record?.momoName} />
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <Badge>{record?.status || "-"}</Badge>
          </div>
        </CardContent>
      </Card>
    </ShowView>
  );
};

function DataItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}
