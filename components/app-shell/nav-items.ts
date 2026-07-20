import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Users,
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
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/lib/enums";

export type NavItem = {
  href: string;
  /** key under the `nav` message namespace */
  key: string;
  icon: LucideIcon;
  roles: Role[];
  /** section key under `nav.sections` */
  section: "operations" | "finance" | "admin";
};

const ALL: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST", "TEACHER", "PARENT"];
const STAFF: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"];
const FINANCE: Role[] = ["ADMIN", "ACCOUNTANT"];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", key: "dashboard", icon: LayoutDashboard, roles: ALL, section: "operations" },
  { href: "/portal/teacher", key: "teacherPortal", icon: GraduationCap, roles: ["TEACHER"], section: "operations" },
  { href: "/portal/parent", key: "parentPortal", icon: UserRound, roles: ["PARENT"], section: "operations" },
  { href: "/calendar", key: "calendar", icon: CalendarRange, roles: STAFF, section: "operations" },
  { href: "/planner", key: "planner", icon: ClipboardList, roles: STAFF, section: "operations" },
  { href: "/checkin", key: "checkin", icon: ScanLine, roles: STAFF, section: "operations" },
  { href: "/sessions", key: "sessions", icon: CalendarDays, roles: STAFF, section: "operations" },
  { href: "/students", key: "students", icon: Users, roles: STAFF, section: "operations" },
  { href: "/teachers", key: "teachers", icon: GraduationCap, roles: STAFF, section: "operations" },
  { href: "/guardians", key: "guardians", icon: UserRound, roles: STAFF, section: "operations" },
  { href: "/leads", key: "leads", icon: UserPlus, roles: STAFF, section: "operations" },
  { href: "/payments", key: "payments", icon: Receipt, roles: STAFF, section: "finance" },
  { href: "/packages", key: "packages", icon: Package, roles: STAFF, section: "finance" },
  { href: "/expenses", key: "expenses", icon: Wallet, roles: FINANCE, section: "finance" },
  { href: "/payroll", key: "payroll", icon: BadgeDollarSign, roles: FINANCE, section: "finance" },
  { href: "/reports", key: "reports", icon: BarChart3, roles: FINANCE, section: "finance" },
  { href: "/settings", key: "settings", icon: Settings, roles: ["ADMIN"], section: "admin" },
];
