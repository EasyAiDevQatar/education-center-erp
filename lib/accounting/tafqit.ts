// Arabic amount-in-words (tafqit) for cheque printing. Pure module.
//
// Covers 0 … 999,999,999.99 — far beyond any cheque this centre writes.
// Currency nouns are passed in so the module stays currency-agnostic
// (QAR: ريال قطري / dirham subunit درهم بواقع 100).

const ONES = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];

function under1000(n: number): string {
  if (n === 0) return "";
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rest > 0) {
    if (rest < 20) parts.push(ONES[rest]);
    else {
      const o = rest % 10;
      const t = Math.floor(rest / 10);
      // Arabic reads units before tens: خمسة وعشرون.
      parts.push(o > 0 ? `${ONES[o]} و${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(" و");
}

function group(n: number, singular: string, dual: string, plural: string): string {
  if (n === 0) return "";
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n <= 10) return `${under1000(n)} ${plural}`;
  return `${under1000(n)} ${singular}`;
}

/** Integer part in words. 0 → "صفر". */
export function intToArabicWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  n = Math.floor(n);
  if (n === 0) return "صفر";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(group(millions, "مليون", "مليونان", "ملايين"));
  if (thousands > 0) parts.push(group(thousands, "ألف", "ألفان", "آلاف"));
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(" و");
}

/**
 * Full cheque phrase: `فقط خمسة آلاف ريال قطري وخمسون درهماً لا غير`.
 * `currencyName` e.g. "ريال قطري", `subunitName` e.g. "درهم" (100 per unit).
 */
export function amountToArabicWords(
  amount: number,
  currencyName = "ريال قطري",
  subunitName = "درهم",
): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  const whole = Math.floor(amount);
  // Round to avoid 0.1+0.2 dust deciding whether a dirham exists.
  const fils = Math.round((amount - whole) * 100);
  const parts: string[] = [];
  parts.push(`${intToArabicWords(whole)} ${currencyName}`);
  if (fils > 0) parts.push(`${intToArabicWords(fils)} ${subunitName}`);
  return `فقط ${parts.join(" و")} لا غير`;
}
