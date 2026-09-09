import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_ITEMS } from "@/components/app-shell/nav-items";
import { OPTIONAL_MODULES } from "@/lib/modules-shared";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { setting: { findUnique: mocks.findUnique, findMany: mocks.findMany } },
}));

vi.mock("@/i18n/navigation", () => ({ redirect: mocks.redirect }));

import { moduleEnabled, moduleFlags, requireModule } from "@/lib/modules";

describe("budget optional-module gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is an on-by-default optional module and hides its navigation when disabled", () => {
    expect(OPTIONAL_MODULES).toContain("budget");
    expect(NAV_ITEMS.find((item) => item.href === "/budget")?.flag).toBe("budget");
  });

  it("keeps existing centres enabled until an administrator explicitly turns it off", async () => {
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ value: "0" });

    await expect(moduleEnabled("budget")).resolves.toBe(true);
    await expect(moduleEnabled("budget")).resolves.toBe(false);
  });

  it("publishes the budget flag with the other app-shell flags", async () => {
    mocks.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { key: "budgetEnabled", value: "0" },
    ]);

    await expect(moduleFlags()).resolves.toMatchObject({ budget: true });
    await expect(moduleFlags()).resolves.toMatchObject({ budget: false });
  });

  it("blocks a bookmarked budget URL while the module is disabled", async () => {
    mocks.findUnique.mockResolvedValue({ value: "0" });

    await requireModule("en", "budget");

    expect(mocks.redirect).toHaveBeenCalledWith({ href: "/dashboard", locale: "en" });
  });
});
