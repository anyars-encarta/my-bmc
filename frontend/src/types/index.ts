import type { ReactNode } from "react";

export type MetricCardProps = {
  title: string;
  value: string;
  description: string;
  icon: ReactNode;
};

export type UploadWidgetValue = {
  url: string;
  publicId?: string | null;
};