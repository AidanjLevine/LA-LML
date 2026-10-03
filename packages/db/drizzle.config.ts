import { defineConfig } from "drizzle-kit";
import { loadRootEnv } from "./src/env.js";

loadRootEnv();

// Migrations use the session pooler (port 5432). `drizzle-kit generate` works offline and ignores this.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_SESSION ?? "" },
});
