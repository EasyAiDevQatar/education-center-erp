/** Opens the committed receipt, falling back to same-tab navigation if popups are blocked. */
export function showPaymentReceipt(
  receiptWindow: Pick<Window, "closed" | "location" | "close"> | null,
  locale: string,
  receiptId: string | undefined,
  navigate: (path: string) => void,
) {
  if (!receiptId) { receiptWindow?.close(); return; }
  const path = `/receipt/${encodeURIComponent(receiptId)}`;
  if (receiptWindow && !receiptWindow.closed) receiptWindow.location.replace(`/${locale}${path}`);
  else navigate(path);
}
