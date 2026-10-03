import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("removes credentials from connection strings", () => {
    expect(redactSecrets("failed: postgresql://postgres.ref:p@ss:word@host:6543/postgres")).toBe(
      "failed: postgresql://<redacted>@host:6543/postgres",
    );
    expect(redactSecrets("postgres://u:p@h/db and POSTGRES://a:b@c/d")).toBe(
      "postgres://<redacted>@h/db and POSTGRES://<redacted>@c/d",
    );
  });

  it("leaves other text alone", () => {
    expect(redactSecrets("connect ETIMEDOUT 1.2.3.4:6543")).toBe("connect ETIMEDOUT 1.2.3.4:6543");
  });
});
