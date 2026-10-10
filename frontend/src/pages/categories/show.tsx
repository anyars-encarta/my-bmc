import { useShow } from "@refinedev/core";

import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type CategoryRecord = {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
};

export const CategoryShow = () => {
  const { result: record } = useShow<CategoryRecord>({});

  return (
    <ShowView className="space-y-4">
      <ShowViewHeader title="Category Details" />
      <Card>
        <CardHeader>
          <CardTitle>{record?.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="mb-2 text-sm font-medium">Category ID</h4>
              <p className="text-sm text-muted-foreground">
                {record?.id || "-"}
              </p>
            </div>
            <div>
              <h4 className="mb-2 text-sm font-medium">Status</h4>
              <Badge variant={record?.isActive ? "default" : "outline"}>
                {record?.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="sm:col-span-2">
              <h4 className="mb-2 text-sm font-medium">Description</h4>
              <p className="text-sm text-muted-foreground">
                {record?.description || "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ShowView>
  );
};
