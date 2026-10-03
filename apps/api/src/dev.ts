// Local development server. Vercel does not use this file.
import { serve } from "@hono/node-server";
import { loadRootEnv } from "@lalml/db/env";

loadRootEnv();
const { default: app } = await import("./index.js");
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}/v1/health`);
});
