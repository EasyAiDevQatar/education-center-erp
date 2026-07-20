/** Shared constants for the Settings data tools (danger zone + import/export).
 *  Plain module (no "use server") so both server routes and client UI can use it. */

/** The exact phrase an admin must type to arm the full data wipe. */
export const WIPE_PHRASE = "DELETE-ALL";

/** Tables exposed to XLSX export/import. `finance` gates to FINANCE_ROLES. */
export type TableKey =
  | "students"
  | "teachers"
  | "guardians"
  | "sessions"
  | "payments"
  | "packages"
  | "expenses"
  | "payouts";

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
      { key: "phone", ar: "الهاتف" },
      { key: "gradeCode", ar: "المرحلة" },
      { key: "guardianName", ar: "ولي الأمر" },
      { key: "address", ar: "العنوان" },
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
];
