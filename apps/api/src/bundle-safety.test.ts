import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Vercel's file tracer bundles every file the deployed code can reach, including files it merely
// builds a path to. If the entry's import graph reaches the local .env loader, a locally built
// deployment would upload the repo's .env (database password included).

const API_SRC = dirname(fileURLToPath(import.meta.url));
const DB_SRC = resolve(API_SRC, "../../../packages/db/src");

function resolveImport(specifier: string, from: string): string | null {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier).replace(/\.js$/, ".ts");
  if (specifier === "@lalml/db") return resolve(DB_SRC, "index.ts");
  if (specifier.startsWith("@lalml/db/")) return resolve(DB_SRC, `${specifier.slice("@lalml/db/".length)}.ts`);
  return null; // third-party package
}

function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const target = resolveImport(specifier!, file);
      if (target) visit(target);
    }
  };
  visit(entry);
  return seen;
}

describe("Vercel bundle safety", () => {
  const graph = importGraph(resolve(API_SRC, "index.ts"));
  const files = [...graph].map((f) => relative(resolve(API_SRC, "../../.."), f));

  it("walks the real import graph", () => {
    expect(files).toEqual(expect.arrayContaining(["apps/api/src/create-app.ts", "packages/db/src/env.ts", "packages/db/src/client.ts"]));
  });

  it("never reaches local-only modules from the deployed entry", () => {
    expect(files).not.toContain("packages/db/src/local-env.ts");
    expect(files).not.toContain("packages/db/src/testing.ts");
    expect(files.filter((f) => f.endsWith("dev.ts"))).toEqual([]);
  });

  it("has no .env file paths in deployed code", () => {
    for (const file of graph) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["'`][^"'`\n]*\.env["'`]/);
    }
  });
});
