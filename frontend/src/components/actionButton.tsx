import type { LucideIcon } from "lucide-react";
import { Download, Eye, Pencil, Printer, Trash2 } from "lucide-react";
import React from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const iconMap: Record<string, LucideIcon> = {
  view: Eye,
  update: Pencil,
  delete: Trash2,
  print: Printer,
  download: Download,
};

export const tableActionButtonClassName =
  "cursor-pointer size-8 shrink-0 p-0 hover:bg-accent/80 hover:text-accent-foreground";

export const actionButtonTitles: Record<string, string> = {
  view: "View record",
  update: "Edit record",
  delete: "Delete record",
  print: "Print report",
  download: "Download PDF",
};

export const ActionTooltip = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent>{title}</TooltipContent>
  </Tooltip>
);

const ActionButton = ({ type }: { type: string }) => {
  const Icon = iconMap[type];

  if (Icon) {
    return <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={2} />;
  }

  return <img src={`/${type}.png`} alt={type} className="w-4 h-4" />;
};

export default ActionButton;
