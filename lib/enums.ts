// String-based enums (kept out of the DB schema so it stays Postgres/SQLite
// portable). Validate against these lists in Zod and use the i18n keys under
// `enums.*` to render labels.

export const ROLES = [
  "ADMIN",
  "ACCOUNTANT",
  "RECEPTIONIST",
  "TEACHER",
  "PARENT",
] as const;
export type Role = (typeof ROLES)[number];

export const LOCATIONS = ["CENTER", "HOME"] as const;
export type LocationType = (typeof LOCATIONS)[number];

export const PAYMENT_METHODS = ["CASH", "POS", "QPAY", "TRANSFER", "CHEQUE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PAID", "PARTIAL", "UNPAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Scheduling/attendance lifecycle of a session (distinct from payment status).
 *  DRAFT = planned on the daily planner, pending confirmation — excluded from
 *  balances/payroll/dashboard until confirmed (confirm = COMPLETED/taught). */
export const SESSION_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "CHECKED_IN",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** How an attendance check-in was captured. */
export const CHECKIN_METHODS = ["KIOSK", "GPS", "QR", "MANUAL"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export const PACKAGE_STATUSES = ["ACTIVE", "COMPLETED", "EXPIRED"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const PAYOUT_STATUSES = ["DRAFT", "PAID"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** How a teacher is paid. Per-teacher; falls back to the centre default. */
export const TEACHER_PAYMENT_MODES = ["SESSION", "MONTH", "TERM"] as const;
export type TeacherPaymentMode = (typeof TEACHER_PAYMENT_MODES)[number];

/** HR: broad staffing areas, not an org chart. */
export const DEPARTMENTS = ["TEACHING", "RECEPTION", "ADMIN", "TRANSPORT", "OTHER"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const EMPLOYEE_STATUSES = ["ACTIVE", "ON_LEAVE", "TERMINATED"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const CONTRACT_TYPES = ["UNLIMITED", "LIMITED"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** Document kinds tracked for expiry. A renewal is a new row, never an edit. */
export const EMPLOYEE_DOC_TYPES = [
  "QID",
  "VISA",
  "PASSPORT",
  "CONTRACT",
  "HEALTH_CARD",
  "LICENCE",
  "OTHER",
] as const;
export type EmployeeDocType = (typeof EMPLOYEE_DOC_TYPES)[number];

/** How a payslip was settled. BANK is what feeds the WPS file. */
export const PAYSLIP_METHODS = ["BANK", "CASH", "CHEQUE"] as const;
export type PayslipMethod = (typeof PAYSLIP_METHODS)[number];

export const RUN_STATUSES = ["DRAFT", "PAID"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/* --- Accounting (optional module) --- */

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** What created a journal entry. MANUAL entries carry a null sourceId. */
export const JOURNAL_SOURCES = ["PAYMENT", "EXPENSE", "PAYROLL", "CHEQUE", "MANUAL"] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/** Expense approval flow (accounting module). APPROVED = real but not on the
    books (the pre-module default); POSTED = journalised. */
export const EXPENSE_STATUSES = ["DRAFT", "APPROVED", "POSTED"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const CHEQUE_DIRECTIONS = ["INCOMING", "OUTGOING"] as const;
export type ChequeDirection = (typeof CHEQUE_DIRECTIONS)[number];

/** Cheque lifecycle (ported from staff-flow, hardened by lib/accounting/cheques). */
export const CHEQUE_STATUSES = [
  "DRAFT",
  "RECEIVED",
  "PENDING_DEPOSIT",
  "DEPOSITED",
  "CLEARED",
  "BOUNCED",
  "REPLACED",
  "CANCELLED",
  "VOID",
] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];

/** When incoming cheques hit the books: on receipt / deposit / clearance. */
export const CHEQUE_POLICIES = ["ON_RECEIPT", "ON_DEPOSIT", "ON_CLEARANCE"] as const;
export type ChequePolicy = (typeof CHEQUE_POLICIES)[number];

/* --- Transport (optional module) --- */

/** Who may see live driver positions. Staff location data is sensitive. */
export const TRACKING_VISIBILITY = ["ADMIN_ONLY", "ADMIN_STAFF"] as const;
export type TrackingVisibility = (typeof TRACKING_VISIBILITY)[number];

/**
 * Trip lifecycle. PROPOSED is the generator's output awaiting a human —
 * allocation never dispatches unreviewed (see lib/transport/trips.ts).
 */
export const TRIP_STATUSES = [
  "PLANNED",
  "PROPOSED",
  "ASSIGNED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const TRIP_STOP_KINDS = ["PICKUP", "DROPOFF"] as const;
export type TripStopKind = (typeof TRIP_STOP_KINDS)[number];

/** Expiring vehicle papers. Like EMPLOYEE_DOC_TYPES, a renewal is a new row. */
export const VEHICLE_DOC_TYPES = [
  "REGISTRATION",
  "INSURANCE",
  "INSPECTION",
  "OTHER",
] as const;
export type VehicleDocType = (typeof VEHICLE_DOC_TYPES)[number];
