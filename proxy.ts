import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Handles locale detection / prefixing. Authentication & RBAC are enforced in
// server layouts and server actions (see lib/session.ts, lib/rbac.ts).
export default createMiddleware(routing);

export const config = {
  // Match all paths except Next internals, API routes, and static files.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
