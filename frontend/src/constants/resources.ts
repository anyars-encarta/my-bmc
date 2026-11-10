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
  menuGroup: "Administration" | "Attendance" | "Finance" | "Overview" | "Workforce";
  label: string;
  icon: LucideIcon;
};

export const appResources: AppResource[] = [
  {
    name: "dashboard",
    list: "/dashboard",
    menuGroup: "Overview",
    label: "Dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "org-units",
    list: "/org-units",
    menuGroup: "Administration",
    label: "Org Units",
    icon: Building2,
  },
  {
    name: "staff",
    list: "/staff",
    create: "/staff/create",
    edit: "/staff/edit/:id",
    show: "/staff/show/:id",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "payroll_officer", "unit_manager", "roster_officer"],
    menuGroup: "Workforce",
    label: "Staff",
    icon: Users,
  },
  {
    name: "transfers",
    list: "/transfers",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager"],
    menuGroup: "Workforce",
    label: "Assignments & Transfers",
    icon: ArrowLeftRight,
  },
  {
    name: "rosters",
    list: "/rosters",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "unit_manager", "roster_officer"],
    menuGroup: "Workforce",
    label: "Rosters",
    icon: CalendarDays,
  },
  {
    name: "devices",
    list: "/devices",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager"],
    menuGroup: "Attendance",
    label: "Attendance Devices",
    icon: Fingerprint,
  },
  {
    name: "attendance",
    list: "/attendance",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "payroll_officer", "accounts", "unit_manager"],
    menuGroup: "Attendance",
    label: "Attendance Operations",
    icon: ClipboardCheck,
  },
  {
    name: "attendance-pilot",
    list: "/attendance-pilot",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager"],
    menuGroup: "Attendance",
    label: "Attendance Pilot",
    icon: Fingerprint,
  },
  {
    name: "my-attendance",
    list: "/my-attendance",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "unit_manager", "roster_officer", "staff"],
    menuGroup: "Attendance",
    label: "My Attendance",
    icon: CalendarRange,
  },
  {
    name: "my-schedule",
    list: "/my-schedule",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "unit_manager", "roster_officer", "staff"],
    menuGroup: "Workforce",
    label: "My Schedule",
    icon: CalendarRange,
  },
  {
    name: "public-holidays",
    list: "/public-holidays",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "unit_manager", "roster_officer"],
    menuGroup: "Workforce",
    label: "Public Holidays",
    icon: CalendarDays,
  },
  {
    name: "staffing-requirements",
    list: "/staffing-requirements",
    allowedRoles: ["super_admin", "hospital_admin", "hr_manager", "payroll_officer", "unit_manager", "roster_officer"],
    menuGroup: "Workforce",
    label: "Staffing Minimums",
    icon: ClipboardList,
  },
  {
    name: "categories",
    list: "/categories",
    create: "/categories/create",
    edit: "/categories/edit/:id",
    show: "/categories/show/:id",
    menuGroup: "Administration",
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
    menuGroup: "Finance",
    label: "Payments",
    icon: Coins,
    canDelete: true,
  },
  {
    name: "approval_queue",
    list: "/approvals",
    menuGroup: "Finance",
    label: "Approval Queue",
    icon: ClipboardCheck,
  },
  {
    name: "disbursements",
    list: "/disbursements",
    menuGroup: "Finance",
    label: "Bulk Disbursement",
    icon: BanknoteArrowDown,
  },
  {
    name: "users",
    list: "/users",
    create: "/users/create",
    edit: "/users/edit/:id",
    show: "/users/show/:id",
    allowedRoles: ["super_admin", "hospital_admin"],
    menuGroup: "Administration",
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
    menuGroup: "Administration",
    label: "Setup",
    icon: Settings2,
    canDelete: true,
  },
];
