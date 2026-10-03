// Local development only: scripts, tests and apps/api/src/dev.ts. Never import this from code that
// ships to Vercel. The file tracer would see the .env path below and bundle your secrets.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Loads the repo-root .env into process.env if it exists. Variables already set win. */
export function loadRootEnv() {
  const path = `${REPO_ROOT}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}
