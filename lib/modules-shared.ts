/**
 * The optional-module names, importable from client components.
 *
 * `lib/modules.ts` is `server-only` because it reads settings from the database;
 * a client panel still needs the list and the type. Keeping the shape here and
 * the queries there lets both sides name the same three modules without either
 * importing the other's world.
 */
export const OPTIONAL_MODULES = ["hr", "reports", "leads"] as const;

export type OptionalModule = (typeof OPTIONAL_MODULES)[number];
