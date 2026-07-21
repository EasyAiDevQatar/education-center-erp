/**
 * Qatari banks and their official WPS short names.
 *
 * Transcribed from Appendix B of the QNB "New WPS file Format" manual
 * (QCB Circular 2020/7, April 2021). The short name is what goes into the
 * SIF's bank columns — the bank parses it, so it is a closed list here rather
 * than a free-text field anywhere in the UI.
 */
export type WpsBank = { code: string; nameEn: string; nameAr: string; swift: string };

export const WPS_BANKS: WpsBank[] = [
  { code: "QNB", nameEn: "Qatar National Bank", nameAr: "بنك قطر الوطني", swift: "QNBAQAQAXXX" },
  { code: "CBQ", nameEn: "Commercial Bank of Qatar", nameAr: "البنك التجاري", swift: "CBQAQAQAXXX" },
  { code: "DBQ", nameEn: "Doha Bank", nameAr: "بنك الدوحة", swift: "DOHBQAQAXXX" },
  { code: "QIB", nameEn: "Qatar Islamic Bank", nameAr: "مصرف قطر الإسلامي", swift: "QISBQAQAXXX" },
  { code: "ABQ", nameEn: "Al Ahli Bank", nameAr: "البنك الأهلي", swift: "ABQQQAQAXXX" },
  { code: "IIB", nameEn: "Qatar International Islamic Bank", nameAr: "الدولي الإسلامي", swift: "QIIBQAQAXXX" },
  { code: "ARB", nameEn: "Arab Bank", nameAr: "البنك العربي", swift: "ARABQAQAXXX" },
  { code: "MSQ", nameEn: "Mashreq Bank", nameAr: "بنك المشرق", swift: "MSHQQAQAXXX" },
  { code: "IBQ", nameEn: "International Bank of Qatar", nameAr: "بنك قطر الدولي", swift: "IBOQQAQAXXX" },
  { code: "HSB", nameEn: "HSBC Bank Middle East", nameAr: "HSBC الشرق الأوسط", swift: "BBMEQAQXXXX" },
  { code: "SCB", nameEn: "Standard Chartered Bank", nameAr: "ستاندرد تشارترد", swift: "SCBLQAQXXXX" },
  { code: "UBL", nameEn: "United Bank Ltd", nameAr: "يونايتد بنك", swift: "UNILQAQAXXX" },
  { code: "BNP", nameEn: "BNP Paribas", nameAr: "بي إن بي باريبا", swift: "BNPAQAQAXXX" },
  { code: "MAR", nameEn: "Masraf Al Rayan", nameAr: "مصرف الريان", swift: "MAFRQAQAXXX" },
  { code: "KCB", nameEn: "Al Khaliji Bank", nameAr: "بنك الخليجي", swift: "KLJIQAQAXXX" },
  { code: "BBQ", nameEn: "Barwa Bank", nameAr: "بنك بروة", swift: "BRWAQAQAXXX" },
  { code: "QDB", nameEn: "Qatar Development Bank", nameAr: "بنك قطر للتنمية", swift: "QIDBQAQAXXX" },
  { code: "BSI", nameEn: "Bank Saderat Iran", nameAr: "بنك صادرات إيران", swift: "BSIRQAQAXXX" },
];

export function bankByCode(code: string | null | undefined): WpsBank | undefined {
  return WPS_BANKS.find((b) => b.code === code);
}
