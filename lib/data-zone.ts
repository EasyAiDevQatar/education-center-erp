/** Shared constants for the Settings data tools (danger zone + import/export).
 *  Plain module (no "use server") so both server routes and client UI can use it. */

/** The exact phrase an admin must type to arm the full data wipe. */
export const WIPE_PHRASE = "DELETE-ALL";

/**
 * The demo seeder's editable counts, in the order the modal shows them.
 *
 * Single source of truth: the zod schema builds its defaults/limits from this
 * and the modal renders its inputs from it, so adding a count is one line here
 * instead of three places that silently drift apart.
 */
export const SEED_SPEC = [
  { key: "teachers", max: 100, default: 10 },
  { key: "guardians", max: 200, default: 8 },
  { key: "students", max: 500, default: 25 },
  { key: "terms", max: 12, default: 2 },
  { key: "packages", max: 200, default: 5 },
  { key: "sessions", max: 2000, default: 60 },
  // Today's roster: sessions stamped checked-in/completed so the attendance
  // screens are alive in a demo, not empty until someone scans a card.
  { key: "checkins", max: 100, default: 8 },
  { key: "payments", max: 1000, default: 20 },
  { key: "expenses", max: 500, default: 12 },
  { key: "availability", max: 500, default: 20 },
  { key: "templates", max: 500, default: 12 },
  { key: "leads", max: 500, default: 10 },
  { key: "trialSessions", max: 50, default: 3 },
  { key: "suppliers", max: 100, default: 5 },
  { key: "cheques", max: 100, default: 6 },
  // Demo teacher/parent portal accounts (password: demo1234).
  { key: "portalUsers", max: 20, default: 2 },
  // HR module
  { key: "employees", max: 100, default: 6 },
  { key: "employeeDocs", max: 300, default: 10 },
  { key: "leaveRequests", max: 200, default: 8 },
  // Up to two years of monthly runs — the old cap of 6 rejected any realistic
  // "show me a year of payroll" demo and surfaced as a bare "invalid".
  { key: "payrollRuns", max: 24, default: 1 },
] as const;

export type SeedKey = (typeof SEED_SPEC)[number]["key"];

/**
 * One-click sizes for the seed modal. Multipliers scale every count off its
 * SEED_SPEC default and are clamped to each field's max, so a preset can
 * never produce a payload the action would reject.
 *
 * `small` is the default single-branch centre; `large` is a stress/demo size
 * that still seeds in a few seconds.
 */
export const SEED_PRESETS = [
  { key: "small", factor: 1 },
  { key: "medium", factor: 3 },
  { key: "large", factor: 8 },
] as const;

export type SeedPresetKey = (typeof SEED_PRESETS)[number]["key"];

/** Counts for a preset: default x factor, capped at each field's max. */
export function presetCounts(preset: SeedPresetKey): Record<SeedKey, number> {
  const factor = SEED_PRESETS.find((p) => p.key === preset)?.factor ?? 1;
  return Object.fromEntries(
    SEED_SPEC.map((s) => [s.key, Math.min(s.max, Math.max(0, Math.round(s.default * factor)))]),
  ) as Record<SeedKey, number>;
}

/** Tables exposed to XLSX export/import. `finance` gates to FINANCE_ROLES. */
export type TableKey =
  | "students"
  | "teachers"
  | "guardians"
  | "sessions"
  | "payments"
  | "packages"
  | "expenses"
  | "payouts"
  | "leads"
  | "terms"
  | "accounts"
  | "journal"
  | "suppliers"
  | "cheques";

export type TableSpec = {
  key: TableKey;
  finance: boolean;
  /** Import supported? (payouts are derived — export only) */
  importable: boolean;
  /** Import/template columns, in order. English keys; Arabic aliases accepted. */
  columns: { key: string; ar: string; required?: boolean }[];
};

export const TABLES: TableSpec[] = [
  {
    key: "students",
    finance: false,
    importable: true,
    columns: [
      { key: "name", ar: "الاسم", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "phone", ar: "الهاتف" },
      { key: "gradeCode", ar: "المرحلة" },
      { key: "studyLocation", ar: "مكان الدراسة" },
      { key: "guardianName", ar: "ولي الأمر" },
      { key: "address", ar: "العنوان" },
      { key: "homeCode", ar: "كود موقع المنزل" },
      { key: "checkinPin", ar: "رمز الحضور" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    key: "teachers",
    finance: false,
    importable: true,
    columns: [
      { key: "name", ar: "الاسم", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "phone", ar: "الهاتف" },
      { key: "commissionPct", ar: "نسبة العمولة" },
      { key: "fixedSalary", ar: "الراتب الثابت" },
      { key: "fixedDeductions", ar: "الخصومات الثابتة" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    key: "guardians",
    finance: false,
    importable: true,
    columns: [
      { key: "name", ar: "الاسم", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "phone", ar: "الهاتف" },
      { key: "email", ar: "البريد الإلكتروني" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    key: "sessions",
    finance: false,
    importable: true,
    columns: [
      { key: "date", ar: "التاريخ", required: true },
      { key: "time", ar: "الوقت" },
      { key: "studentName", ar: "الطالب", required: true },
      { key: "teacherName", ar: "المعلم", required: true },
      { key: "gradeCode", ar: "المرحلة" },
      { key: "location", ar: "المكان" },
      { key: "hours", ar: "الساعات", required: true },
      { key: "status", ar: "الحالة" },
      { key: "paymentStatus", ar: "حالة الدفع" },
    ],
  },
  {
    key: "payments",
    finance: true,
    importable: true,
    columns: [
      { key: "date", ar: "التاريخ", required: true },
      { key: "receiptNo", ar: "رقم الإيصال" },
      { key: "studentName", ar: "الطالب" },
      { key: "teacherName", ar: "المعلم" },
      { key: "amount", ar: "المبلغ", required: true },
      { key: "method", ar: "طريقة الدفع" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    key: "packages",
    finance: false,
    importable: true,
    columns: [
      { key: "studentName", ar: "الطالب", required: true },
      { key: "totalHours", ar: "إجمالي الساعات", required: true },
      { key: "hoursUsed", ar: "الساعات المستخدمة" },
      { key: "price", ar: "السعر", required: true },
      { key: "purchasedAt", ar: "تاريخ الشراء" },
      { key: "expiresAt", ar: "تاريخ الانتهاء" },
    ],
  },
  {
    key: "expenses",
    finance: true,
    importable: true,
    columns: [
      { key: "date", ar: "التاريخ", required: true },
      { key: "description", ar: "البيان", required: true },
      { key: "categoryAr", ar: "النوع", required: true },
      { key: "amount", ar: "المبلغ", required: true },
      { key: "paidTo", ar: "المستفيد" },
    ],
  },
  {
    key: "payouts",
    finance: true,
    importable: false,
    columns: [
      { key: "teacherName", ar: "المعلم" },
      { key: "periodStart", ar: "بداية الفترة" },
      { key: "periodEnd", ar: "نهاية الفترة" },
      { key: "grossCommission", ar: "العمولة المستحقة" },
      { key: "fixedSalary", ar: "الراتب الثابت" },
      { key: "deductions", ar: "الخصومات" },
      { key: "advances", ar: "السلف" },
      { key: "netPaid", ar: "الصافي" },
      { key: "status", ar: "الحالة" },
    ],
  },
  {
    key: "leads",
    finance: false,
    importable: true,
    columns: [
      { key: "name", ar: "الاسم", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "phone", ar: "الهاتف" },
      { key: "email", ar: "البريد الإلكتروني" },
      { key: "source", ar: "مصدر العميل" },
      { key: "status", ar: "الحالة" },
      { key: "gradeCode", ar: "المرحلة" },
      { key: "followUpAt", ar: "تاريخ المتابعة" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    key: "terms",
    finance: false,
    importable: true,
    columns: [
      { key: "nameAr", ar: "الاسم بالعربية", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "startDate", ar: "تاريخ البداية", required: true },
      { key: "endDate", ar: "تاريخ النهاية", required: true },
    ],
  },
  {
    key: "accounts",
    finance: true,
    importable: true,
    columns: [
      { key: "code", ar: "رمز الحساب", required: true },
      { key: "nameAr", ar: "الاسم بالعربية", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "type", ar: "النوع", required: true },
      { key: "parentCode", ar: "الحساب الأب" },
      { key: "active", ar: "نشط" },
    ],
  },
  {
    key: "suppliers",
    finance: true,
    importable: true,
    columns: [
      { key: "name", ar: "الاسم", required: true },
      { key: "nameEn", ar: "الاسم بالإنجليزية" },
      { key: "phone", ar: "الهاتف" },
      { key: "email", ar: "البريد الإلكتروني" },
      { key: "taxNo", ar: "الرقم الضريبي" },
      { key: "address", ar: "العنوان" },
      { key: "notes", ar: "ملاحظات" },
    ],
  },
  {
    // Export-only: cheques are created through payments (incoming) or the
    // cheque-book issue flow (outgoing) — never imported raw.
    key: "cheques",
    finance: true,
    importable: false,
    columns: [
      { key: "chequeNo", ar: "رقم الشيك" },
      { key: "direction", ar: "الاتجاه" },
      { key: "status", ar: "الحالة" },
      { key: "party", ar: "الطرف" },
      { key: "bankName", ar: "البنك" },
      { key: "amount", ar: "المبلغ" },
      { key: "dueDate", ar: "تاريخ الاستحقاق" },
    ],
  },
  {
    // Export-only: the journal is derived from source documents (or entered
    // through the balanced manual dialog) — importing raw lines would bypass
    // the balance check.
    key: "journal",
    finance: true,
    importable: false,
    columns: [
      { key: "date", ar: "التاريخ" },
      { key: "memo", ar: "البيان" },
      { key: "source", ar: "المصدر" },
      { key: "accountCode", ar: "رمز الحساب" },
      { key: "accountName", ar: "الحساب" },
      { key: "debit", ar: "مدين" },
      { key: "credit", ar: "دائن" },
    ],
  },
];
