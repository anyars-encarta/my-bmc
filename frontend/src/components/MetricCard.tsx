import { MetricCardProps } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const MetricCard = ({ title, value, description, icon }: MetricCardProps) => {
  return (
    <Card className="group border-0 shadow-md ring-1 ring-border transition-transform duration-200 hover:-translate-y-1">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-cyan-600">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

export default MetricCard;

