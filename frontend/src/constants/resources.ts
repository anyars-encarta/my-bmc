import {
  BanknoteArrowDown,
  ClipboardCheck,
  Coins,
  LayoutDashboard,
  Layers3,
  Settings2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type AppResource = {
  name: string;
  list: string;
  create?: string;
  edit?: string;
  show?: string;
  canDelete?: boolean;
  label: string;
  icon: LucideIcon;
};

export const appResources: AppResource[] = [
  {
    name: "dashboard",
    list: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "staff",
    list: "/staff",
    create: "/staff/create",
    edit: "/staff/edit/:id",
    show: "/staff/show/:id",
    label: "Staff",
    icon: Users,
    canDelete: true,
  },
  {
    name: "categories",
    list: "/categories",
    create: "/categories/create",
    edit: "/categories/edit/:id",
    show: "/categories/show/:id",
    label: "Categories",
    icon: Layers3,
    canDelete: true,
  },
  {
    name: "payments",
    list: "/payments",
    create: "/payments/create",
    edit: "/payments/edit/:id",
    show: "/payments/show/:id",
    label: "Payments",
    icon: Coins,
    canDelete: true,
  },
  {
    name: "setup",
    list: "/setup",
    create: "/setup/create",
    edit: "/setup/edit/:id",
    show: "/setup/show/:id",
    label: "Setup",
    icon: Settings2,
    canDelete: true,
  },
  {
    name: "approval_queue",
    list: "/approvals",
    label: "Approval Queue",
    icon: ClipboardCheck,
  },
  {
    name: "disbursements",
    list: "/disbursements",
    label: "MTN Bulk Disbursement",
    icon: BanknoteArrowDown,
  },
];
