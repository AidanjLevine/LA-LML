import { defineConfig } from "vitest/config";

// PGlite with PostGIS takes a moment to boot and migrate.
export default defineConfig({ test: { hookTimeout: 60_000, testTimeout: 30_000 } });
