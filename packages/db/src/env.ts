import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Loads the repo-root .env into process.env if it exists. Variables already set win. */
export function loadRootEnv() {
  const path = `${REPO_ROOT}.env`;
  if (existsSync(path)) process.loadEnvFile(path);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env at the repo root (see .env.example).`);
  }
  return value;
}
