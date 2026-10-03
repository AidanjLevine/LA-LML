// pnpm shows:paste <file> [--commit]
// Dry run by default: prints what would happen and writes nothing. --commit writes it in one transaction.
// Uses DATABASE_URL_SESSION (session pooler) from the repo-root .env, like the seed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDb } from "@lalml/db";
import { requireEnv } from "@lalml/db/env";
import { loadRootEnv } from "@lalml/db/local-env";
import { commitPaste } from "./apply.js";
import { parsePaste, todayInLosAngeles } from "./parse.js";
import { planPaste } from "./plan.js";
import { formatPlan, formatSummary } from "./report.js";

const USAGE = "Usage: pnpm shows:paste <file> [--commit]\nFormat: docs/BULK_PASTE.md";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const unknownFlags = args.filter((a) => a.startsWith("-") && a !== "--commit");
const files = args.filter((a) => !a.startsWith("-"));
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
if (files.length !== 1 || unknownFlags.length) {
  console.error(unknownFlags.length ? `Unknown option ${unknownFlags.join(", ")}\n${USAGE}` : USAGE);
  process.exit(2);
}

// pnpm runs scripts from the package directory; resolve the file from where you ran the command.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), files[0]!);
const parsed = parsePaste(readFileSync(file, "utf8"), todayInLosAngeles());

loadRootEnv();
const { db, close } = createDb(requireEnv("DATABASE_URL_SESSION"));
try {
  if (!commit) {
    const plan = await planPaste(db, parsed);
    console.log(formatPlan(plan));
    console.log(`\nDry run: nothing was written.${plan.errors.length ? "" : " Run again with --commit to save."}`);
    process.exitCode = plan.errors.length ? 1 : 0;
  } else {
    const { plan, summary } = await commitPaste(db, parsed, { file: files[0]!, now: new Date() });
    console.log(formatPlan(plan));
    if (!summary) {
      console.error("\nNot committed: fix the errors above. Nothing was written.");
      process.exitCode = 1;
    } else {
      console.log(`\n${formatSummary(summary)}`);
    }
  }
} finally {
  await close();
}
