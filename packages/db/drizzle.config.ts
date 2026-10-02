import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` works offline; DATABASE_URL is only needed for migrate/push later.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
