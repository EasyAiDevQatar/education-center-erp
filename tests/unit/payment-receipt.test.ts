import { describe, expect, it, vi } from "vitest";
import { showPaymentReceipt } from "../../lib/payment-receipt";

describe("payment receipt navigation", () => {
  const popup = (closed = false) => ({ closed, location: { replace: vi.fn() } as unknown as Location, close: vi.fn() });
  it("opens the saved receipt in the selected language", () => {
    const tab = popup();
    const navigate = vi.fn();
    showPaymentReceipt(tab, "ar", "payment-1", navigate);
    expect(tab.location.replace).toHaveBeenCalledWith("/ar/receipt/payment-1");
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each([null, popup(true)])("falls back if the print tab is unavailable", (tab) => {
    const navigate = vi.fn();
    showPaymentReceipt(tab, "en", "payment-1", navigate);
    expect(navigate).toHaveBeenCalledWith("/receipt/payment-1");
  });
  it("does not navigate without a committed receipt", () => {
    const tab = popup();
    const navigate = vi.fn();
    showPaymentReceipt(tab, "en", undefined, navigate);
    expect(tab.close).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
