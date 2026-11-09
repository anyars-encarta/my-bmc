import {
  BanknoteArrowDown,
  ArrowLeftRight,
  ClipboardCheck,
  ClipboardList,
  Coins,
  Building2,
  CalendarDays,
  CalendarRange,
  Fingerprint,
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
  allowedRoles?: string[];
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
    name: "org-units",
    list: "/org-units",
    label: "Org Units",
    icon: Building2,
  },
  {
    name: "staff",
    list: "/staff",
    create: "/staff/create",
    edit: "/staff/edit/:id",
    show: "/staff/show/:id",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "PAYROLL_OFFICER", "UNIT_MANAGER", "ROSTER_OFFICER"],
    label: "Staff",
    icon: Users,
  },
  {
    name: "transfers",
    list: "/transfers",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"],
    label: "Assignments & Transfers",
    icon: ArrowLeftRight,
  },
  {
    name: "rosters",
    list: "/rosters",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER"],
    label: "Rosters",
    icon: CalendarDays,
  },
  {
    name: "devices",
    list: "/devices",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"],
    label: "Attendance Devices",
    icon: Fingerprint,
  },
  {
    name: "attendance",
    list: "/attendance",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "PAYROLL_OFFICER", "ACCOUNTS", "UNIT_MANAGER"],
    label: "Attendance Operations",
    icon: ClipboardCheck,
  },
  {
    name: "attendance-pilot",
    list: "/attendance-pilot",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER"],
    label: "Attendance Pilot",
    icon: Fingerprint,
  },
  {
    name: "my-attendance",
    list: "/my-attendance",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER", "STAFF"],
    label: "My Attendance",
    icon: CalendarRange,
  },
  {
    name: "my-schedule",
    list: "/my-schedule",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER", "STAFF"],
    label: "My Schedule",
    icon: CalendarRange,
  },
  {
    name: "public-holidays",
    list: "/public-holidays",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "UNIT_MANAGER", "ROSTER_OFFICER"],
    label: "Public Holidays",
    icon: CalendarDays,
  },
  {
    name: "staffing-requirements",
    list: "/staffing-requirements",
    allowedRoles: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "HR_MANAGER", "PAYROLL_OFFICER", "UNIT_MANAGER", "ROSTER_OFFICER"],
    label: "Staffing Minimums",
    icon: ClipboardList,
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
    name: "approval_queue",
    list: "/approvals",
    label: "Approval Queue",
    icon: ClipboardCheck,
  },
  {
    name: "disbursements",
    list: "/disbursements",
    label: "Bulk Disbursement",
    icon: BanknoteArrowDown,
  },
  {
    name: "users",
    list: "/users",
    create: "/users/create",
    edit: "/users/edit/:id",
    show: "/users/show/:id",
    label: "Users",
    icon: Users,
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
];
