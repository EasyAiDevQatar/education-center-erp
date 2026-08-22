"use server";

import { revalidatePath } from "next/cache";
import { openGate, setGatePassword, closeGate } from "@/lib/integrations/gate";

export type GateState = { ok?: boolean; error?: string };

/**
 * Unlock the EasyAiConnect module for this browser.
 *
 * Thin on purpose — every check lives in lib/integrations/gate.ts so the page,
 * these actions and the integration actions cannot disagree about who is in.
 */
export async function unlockConnect(locale: string, password: string): Promise<GateState> {
  const res = await openGate(password);
  if (res.ok) revalidatePath(`/${locale}/settings`);
  return res;
}

/** Set the module password, or change it from inside an already-open gate. */
export async function setConnectPassword(locale: string, password: string): Promise<GateState> {
  const res = await setGatePassword(password);
  if (res.ok) revalidatePath(`/${locale}/settings`);
  return res;
}

/** Lock it again without waiting for the cookie to lapse. */
export async function lockConnect(locale: string): Promise<GateState> {
  await closeGate();
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}
