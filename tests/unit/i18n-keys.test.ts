import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

/**
 * Every translation key a component asks for must exist in both locales.
 *
 * next-intl does not fail a build on a missing key — it renders the key path
 * itself, so a button reads "common.close" to whoever opened that dialog. That
 * has shipped more than once here, always found by a person rather than by the
 * gates. This test reads the call sites instead of waiting for a screenshot.
 *
 * Dynamic keys (`t(\`scanErrors.${code}\`)`) cannot be resolved statically; the
 * literal prefix is checked instead, which catches a renamed or missing group
 * even though it cannot prove every branch.
 */

const ROOTS = ["app", "components"];
const MESSAGES: Record<string, unknown> = { ar, en };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

function lookup(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

type Ref = { file: string; key: string; dynamic: boolean };

/** Collects `ns.key` for every translator call in one file. */
function refsIn(file: string): Ref[] {
  const src = readFileSync(file, "utf8");
  const refs: Ref[] = [];

  // const tc = useTranslations("common");  /  const t = await getTranslations("planner")
  //
  // Bindings are kept with their offset, not collapsed into a name→namespace
  // map: one file routinely holds several components that each bind `t` to a
  // different namespace, and a last-one-wins map would judge the earlier
  // components' keys against the wrong namespace.
  const binders: { name: string; ns: string; at: number }[] = [];
  const bindRe =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:"([^"]*)"|'([^']*)')?\s*\)/g;
  for (const m of src.matchAll(bindRe)) {
    binders.push({ name: m[1], ns: m[2] ?? m[3] ?? "", at: m.index });
  }
  if (binders.length === 0) return refs;

  /** The binding of `name` that is nearest above `at`. */
  const nsFor = (name: string, at: number) =>
    binders.filter((b) => b.name === name && b.at < at).at(-1)?.ns;

  const names = [...new Set(binders.map((b) => b.name))].join("|");
  // t("a.b")  |  t(`a.${x}`)
  const callRe = new RegExp(`\\b(${names})\\(\\s*(?:"([^"]+)"|'([^']+)'|\`([^\`]+)\`)`, "g");
  for (const m of src.matchAll(callRe)) {
    const ns = nsFor(m[1], m.index);
    if (ns === undefined) continue; // a call above its own binding is not ours
    const raw = m[2] ?? m[3] ?? m[4];
    const dynamic = m[4] !== undefined && m[4].includes("${");
    // For a template, keep only the literal head: "scanErrors.${e}" → "scanErrors"
    const literal = dynamic ? raw.slice(0, raw.indexOf("${")).replace(/\.$/, "") : raw;
    if (!literal) continue; // a wholly dynamic key tells us nothing
    refs.push({ file, key: ns ? `${ns}.${literal}` : literal, dynamic });
  }
  return refs;
}

const allRefs = ROOTS.flatMap((r) => walk(r)).flatMap(refsIn);

describe("i18n keys", () => {
  it("finds translator call sites to check", () => {
    // Guards the scanner itself: a regex that silently stops matching would
    // otherwise make this whole suite pass by checking nothing.
    expect(allRefs.length).toBeGreaterThan(200);
  });

  for (const locale of ["ar", "en"] as const) {
    it(`resolves every key used in the app (${locale})`, () => {
      const missing = allRefs
        .filter((r) => {
          const v = lookup(MESSAGES[locale], r.key);
          // A literal key must be a string; a dynamic prefix must be a group.
          return r.dynamic ? typeof v !== "object" || v === null : typeof v !== "string";
        })
        .map((r) => `${r.key}  (${r.file}${r.dynamic ? ", dynamic prefix" : ""})`);

      expect(missing, `missing ${locale} messages:\n${missing.join("\n")}`).toEqual([]);
    });
  }

  it("keeps ar and en in step", () => {
    const flatten = (o: unknown, prefix = "", out: string[] = []): string[] => {
      if (o && typeof o === "object") {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          typeof v === "object" && v !== null
            ? flatten(v, `${prefix}${k}.`, out)
            : out.push(`${prefix}${k}`);
        }
      }
      return out;
    };
    const a = new Set(flatten(ar));
    const e = new Set(flatten(en));
    const onlyAr = [...a].filter((k) => !e.has(k));
    const onlyEn = [...e].filter((k) => !a.has(k));
    expect({ onlyAr, onlyEn }).toEqual({ onlyAr: [], onlyEn: [] });
  });
});
