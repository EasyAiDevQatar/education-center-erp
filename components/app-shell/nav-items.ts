import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Users,
  Users2,
  GraduationCap,
  UserRound,
  Receipt,
  Package,
  Wallet,
  BadgeDollarSign,
  ScanLine,
  ClipboardList,
  BarChart3,
  UserPlus,
  BriefcaseBusiness,
  Landmark,
  Truck,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/enums";

export type NavItem = {
  href: string;
  /** key under the `nav` message namespace */
  key: string;
  icon: LucideIcon;
  roles: Role[];
  /** section key under `nav.sections`. A section with no visible items renders
      nothing, so a flagged-off module costs zero pixels. */
  section: "operations" | "people" | "finance" | "hr" | "admin";
  /** Nested links, shown indented while the parent branch is active. */
  children?: { href: string; key: string }[];
  /** Optional-module gate: item renders only when this flag is on. The flag
      value comes from Settings, read server-side in the (app) layout. */
  flag?: "accounting" | "transport" | "ai" | "hr" | "reports" | "leads";
};

const ALL: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST", "TEACHER", "PARENT"];
const STAFF: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"];
const FINANCE: Role[] = ["ADMIN", "ACCOUNTANT"];
// Menu lists mirror the capability sets in lib/rbac.ts. They are UX; the route
// guards are the enforcement. Keeping the two in step is what stops a role
// seeing a link it cannot open.
const ACADEMIC: Role[] = [...STAFF, "ACADEMIC_SUPERVISOR"];
const PEOPLE: Role[] = [...STAFF, "ACADEMIC_SUPERVISOR", "CASHIER"];
const BILLING: Role[] = [...STAFF, "CASHIER"];
const PAYROLL: Role[] = ["ADMIN", "ACCOUNTANT", "HR_OFFICER"];
const TRANSPORT: Role[] = [...STAFF, "TRANSPORT_COORDINATOR"];
// Reading the week is wider than owning it — see CALENDAR_VIEW_ROLES.
const CALENDAR: Role[] = [...ACADEMIC, "CASHIER"];
const HR: Role[] = ["ADMIN", "HR_OFFICER"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard, roles: ALL, section: "operations" },
  { href: "/portal/teacher", key: "teacherPortal", icon: GraduationCap, roles: ["TEACHER"], section: "operations" },
  { href: "/portal/parent", key: "parentPortal", icon: UserRound, roles: ["PARENT"], section: "operations" },
  { href: "/calendar", key: "calendar", icon: CalendarRange, roles: CALENDAR, section: "operations" },
  { href: "/planner", key: "planner", icon: ClipboardList, roles: ACADEMIC, section: "operations" },
  {
    href: "/checkin",
    key: "checkin",
    icon: ScanLine,
    roles: ACADEMIC,
    section: "operations",
    children: [
      { href: "/checkin", key: "roster" },
      { href: "/checkin/scan", key: "scan" },
      { href: "/checkin/cards", key: "qrCards" },
    ],
  },
  { href: "/sessions", key: "sessions", icon: CalendarDays, roles: ACADEMIC, section: "operations" },
  { href: "/assistant", key: "assistant", icon: Sparkles, roles: STAFF, section: "operations", flag: "ai" },
  { href: "/students", key: "students", icon: Users, roles: PEOPLE, section: "people" },
  { href: "/teachers", key: "teachers", icon: GraduationCap, roles: PEOPLE, section: "people" },
  { href: "/guardians", key: "guardians", icon: UserRound, roles: PEOPLE, section: "people" },
  { href: "/leads", key: "leads", icon: UserPlus, roles: ACADEMIC, section: "people", flag: "leads" },
  { href: "/groups", key: "groups", icon: Users2, roles: ACADEMIC, section: "people" },
  { href: "/payments", key: "payments", icon: Receipt, roles: BILLING, section: "finance" },
  { href: "/packages", key: "packages", icon: Package, roles: BILLING, section: "finance" },
  { href: "/expenses", key: "expenses", icon: Wallet, roles: FINANCE, section: "finance" },
  {
    href: "/payroll",
    key: "payroll",
    icon: BadgeDollarSign,
    roles: PAYROLL,
    section: "finance",
    children: [
      { href: "/payroll", key: "payrollDues" },
      { href: "/payroll/runs", key: "payrollRuns" },
    ],
  },
  { href: "/reports", key: "reports", icon: BarChart3, roles: FINANCE, section: "finance", flag: "reports" },
  {
    href: "/accounting",
    key: "accounting",
    icon: Landmark,
    roles: FINANCE,
    section: "finance",
    flag: "accounting",
    children: [
      { href: "/accounting/journal", key: "accountingJournal" },
      { href: "/accounting/accounts", key: "accountingAccounts" },
      { href: "/accounting/cheques", key: "accountingCheques" },
      { href: "/accounting/suppliers", key: "accountingSuppliers" },
      { href: "/accounting/reports", key: "accountingReports" },
    ],
  },
  {
    href: "/transport",
    key: "transport",
    icon: Truck,
    roles: TRANSPORT,
    // Transport lives with the other daily-operations screens: the planner and
    // the driver board are used on the same rhythm as the calendar, not as a
    // back-office register.
    section: "operations",
    flag: "transport",
    children: [
      { href: "/transport/master", key: "transportMaster" },
      { href: "/transport/planner", key: "transportPlanner" },
      { href: "/transport/manifest", key: "transportManifest" },
      { href: "/transport/trips", key: "transportTrips" },
      { href: "/transport/map", key: "transportMap" },
      { href: "/transport/vehicles", key: "transportVehicles" },
      { href: "/transport/drivers", key: "transportDrivers" },
      { href: "/transport/costs", key: "transportCosts" },
      { href: "/transport/reports", key: "transportReports" },
    ],
  },
  // ADMIN only: the HR register carries QID/passport/IBAN — a categorically
  // more sensitive surface than anything else in the app.
  {
    href: "/hr",
    key: "hr",
    icon: BriefcaseBusiness,
    roles: HR,
    section: "hr",
    flag: "hr",
    children: [
      { href: "/hr", key: "hrRegister" },
      { href: "/hr/documents", key: "hrDocuments" },
      { href: "/hr/leave", key: "hrLeave" },
    ],
  },
  { href: "/settings", key: "settings", icon: Settings, roles: ["ADMIN"], section: "admin" },
];
