import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native <select> styled to match the design system. Native selects are the most
 * reliable choice inside server-action forms and for keyboard/RTL behavior.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      // py-1, not py-2: callers routinely override the height (h-8 for compact
      // toolbars). At h-8 a 2×8px padding leaves a 14px content box for a 20px
      // line, and the glyphs clip — the text looks cut in half. 4px keeps the
      // content box taller than the line at every height we use, and a native
      // select centres its text in whatever room it has.
      "flex h-10 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export { Select };
