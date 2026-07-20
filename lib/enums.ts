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

export const PAYMENT_METHODS = ["CASH", "POS", "QPAY", "TRANSFER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PAID", "PARTIAL", "UNPAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Scheduling/attendance lifecycle of a session (distinct from payment status). */
export const SESSION_STATUSES = [
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
