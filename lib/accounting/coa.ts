// Default chart of accounts for the optional accounting module.
//
// Pure module (no imports, no "server-only") so it can be unit tested — this
// list is what every posting rule's account codes resolve against, so a typo
// here is money in the wrong bucket.
//
// Codes follow the conventional 4-digit blocks: 1000s assets, 2000s
// liabilities, 3000s equity, 4000s income, 5000s expenses. Arabic-first names,
// like every people record in the system.

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";

export type DefaultAccount = {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  parentCode?: string;
};

/** The codes posting rules depend on. Every one must exist in DEFAULT_ACCOUNTS. */
export const ACCOUNT_CODES = {
  cash: "1000",
  bank: "1010",
  onlineClearing: "1020",
  chequesInHand: "1030",
  chequesInClearing: "1040",
  receivable: "1100",
  returnedCheques: "1110",
  payable: "2000",
  chequesIssued: "2110",
  equity: "3000",
  revenue: "4000",
  refunds: "4900",
  salaries: "5000",
  miscExpense: "5900",
} as const;

export const DEFAULT_ACCOUNTS: DefaultAccount[] = [
  { code: "1000", nameAr: "الخزينة (نقدية)", nameEn: "Cash", type: "ASSET" },
  { code: "1010", nameAr: "البنك", nameEn: "Bank", type: "ASSET" },
  { code: "1020", nameAr: "مقاصة الدفع الإلكتروني", nameEn: "Online clearing", type: "ASSET" },
  { code: "1030", nameAr: "شيكات برسم التحصيل", nameEn: "Cheques in hand", type: "ASSET" },
  { code: "1040", nameAr: "شيكات في المقاصة", nameEn: "Cheques in clearing", type: "ASSET" },
  { code: "1100", nameAr: "ذمم مدينة", nameEn: "Accounts receivable", type: "ASSET" },
  { code: "1110", nameAr: "شيكات مرتجعة", nameEn: "Returned cheques", type: "ASSET" },
  { code: "1500", nameAr: "أجهزة ومعدات", nameEn: "Equipment", type: "ASSET" },
  { code: "2000", nameAr: "ذمم دائنة", nameEn: "Accounts payable", type: "LIABILITY" },
  { code: "2110", nameAr: "شيكات صادرة", nameEn: "Cheques issued", type: "LIABILITY" },
  { code: "3000", nameAr: "حقوق الملكية", nameEn: "Owner equity", type: "EQUITY" },
  { code: "4000", nameAr: "إيرادات الدروس", nameEn: "Tuition revenue", type: "INCOME" },
  { code: "4900", nameAr: "مردودات ومسترجعات", nameEn: "Refunds", type: "INCOME" },
  { code: "5000", nameAr: "رواتب وأجور", nameEn: "Salaries", type: "EXPENSE" },
  { code: "5100", nameAr: "مواصلات وبترول", nameEn: "Transport & fuel", type: "EXPENSE" },
  { code: "5300", nameAr: "إيجارات", nameEn: "Rent", type: "EXPENSE" },
  { code: "5310", nameAr: "كهرباء ومياه وإنترنت", nameEn: "Utilities", type: "EXPENSE" },
  { code: "5400", nameAr: "صيانة", nameEn: "Maintenance", type: "EXPENSE" },
  { code: "5500", nameAr: "دعاية وإعلان", nameEn: "Marketing", type: "EXPENSE" },
  { code: "5600", nameAr: "أدوات مكتبية", nameEn: "Office supplies", type: "EXPENSE" },
  { code: "5700", nameAr: "مشتريات معدات", nameEn: "Equipment purchases", type: "EXPENSE" },
  { code: "5900", nameAr: "مصروفات متنوعة", nameEn: "Miscellaneous", type: "EXPENSE" },
];

/**
 * Which side increases an account of this type. Assets/expenses grow by debit;
 * liabilities/equity/income grow by credit. Statement running balances and the
 * P&L sign convention both hang off this.
 */
export function normalSide(type: AccountType): "debit" | "credit" {
  return type === "ASSET" || type === "EXPENSE" ? "debit" : "credit";
}
