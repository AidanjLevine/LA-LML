// Production-safe env access. Must not touch the filesystem or mention a .env path: Vercel's file
// tracer bundles any file this module points at. Local .env loading lives in local-env.ts.

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env at the repo root (see .env.example).`);
  }
  return value;
}
