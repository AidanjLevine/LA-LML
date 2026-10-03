/**
 * Strips credentials from connection strings (postgres://user:password@host -> postgres://<redacted>@host).
 * Runs to the last "@" before the host, so an unencoded "@" inside the password is removed too.
 */
export function redactSecrets(text: string): string {
  return text.replace(/\b(postgres(?:ql)?:\/\/)[^\s/'"]+@/gi, "$1<redacted>@");
}

/** console.error that never prints a connection string, even if a driver puts one in an error. */
export function logError(context: string, error: unknown) {
  const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
  console.error(`${context}: ${redactSecrets(detail)}`);
}
