import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/app-shell/nav-items";
import { ROLES } from "@/lib/enums";

describe("role navigation", () => {
  it("gives every authenticated role a dashboard link", () => {
    const dashboard = NAV_ITEMS.find((item) => item.href === "/dashboard");

    expect(dashboard).toBeDefined();
    expect(new Set(dashboard?.roles)).toEqual(new Set(ROLES));
  });
});
