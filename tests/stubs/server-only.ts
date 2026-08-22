/**
 * A no-op stand-in for Next.js's `server-only` guard.
 *
 * That package exists to break the BUILD if a server module is imported from a
 * client component. Under vitest there is no client, and the real package
 * throws on import, so a server module could not otherwise be unit tested at
 * all — which is how lib/integrations/secret-crypto.ts came to need this.
 *
 * Aliased in vitest.config.ts only. The real guard still applies to the app.
 */
export {};
