import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-gradient-to-b from-accent/40 to-background">
      <div className="flex justify-end p-4">
        <LocaleSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        {children}
      </div>
    </div>
  );
}
