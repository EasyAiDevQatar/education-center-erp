/** Shared contracts for outbound integrations (messaging today, more later). */

/** Business events that can trigger a notification. */
export const INTEGRATION_EVENTS = [
  "SESSION_BOOKED",
  "SESSION_RESCHEDULED",
  "SESSION_CANCELLED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "PAYMENT_RECEIVED",
  "PAYOUT_PAID",
  "BALANCE_REMINDER",
] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

/** Who receives a notification. */
export const AUDIENCES = ["TEACHER", "PARENT", "STUDENT"] as const;
export type Audience = (typeof AUDIENCES)[number];

/** Stored, decrypted configuration for one provider. */
export type IntegrationConfig = {
  provider: string;
  enabled: boolean;
  baseUrl: string | null;
  apiKey: string | null;
  /** Parsed from the `config` JSON column. */
  config: Record<string, string>;
  events: IntegrationEvent[];
  audiences: Audience[];
};

export type SendInput = {
  /** Destination — usually an E.164 phone number. */
  to: string;
  /** Rendered message body (already localized). */
  text: string;
};

export type ProviderResult = { ok: boolean; message?: string; error?: string };

/** A settings field rendered on the Integrations screen. */
export type ProviderField = {
  key: string;
  labelKey: string;
  placeholder?: string;
  /** `secret` fields are masked in the UI and never sent back to the client. */
  type?: "text" | "secret" | "url";
  required?: boolean;
  help?: string;
};

/** Everything the app needs to render, test and use a provider. */
export type Provider = {
  key: string;
  /** Human label (not translated — these are product names). */
  label: string;
  docsUrl?: string;
  /** Extra provider-specific fields stored in `config`. */
  fields: ProviderField[];
  /** Verify credentials/connectivity without sending a real message. */
  testConnection: (cfg: IntegrationConfig) => Promise<ProviderResult>;
  /** Deliver one message. */
  send: (cfg: IntegrationConfig, input: SendInput) => Promise<ProviderResult>;
};
