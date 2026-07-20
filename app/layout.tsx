import type { ReactNode } from "react";

// The <html>/<body> tags live in app/[locale]/layout.tsx so the document can be
// rendered with the correct lang/dir per locale. This root simply passes through.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
