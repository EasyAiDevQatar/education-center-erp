"use client";

import { createContext, useContext } from "react";

export type ModuleFlags = { accounting: boolean; transport: boolean; ai: boolean };

/**
 * Which optional modules are switched on, for any client component under the
 * shell.
 *
 * The flags were already read once per request in the (app) layout and handed
 * to the nav. Everything else that shows a module's UI — a trip icon on a
 * session card, a mini-map in a hover card, a "plan trips?" prompt — was
 * deciding on its own, which is to say not deciding at all: switching transport
 * off emptied the menu and left the icons.
 *
 * Defaults are all `false` on purpose. A component rendered outside the shell
 * hides its optional UI rather than showing it, so the failure mode is a
 * missing icon rather than a live button into a module that is off.
 */
const Ctx = createContext<ModuleFlags>({ accounting: false, transport: false, ai: false });

export const ModuleFlagsProvider = Ctx.Provider;

export function useModuleFlags(): ModuleFlags {
  return useContext(Ctx);
}
