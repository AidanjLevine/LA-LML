// Ingestion: bulk paste now (src/paste, run with `pnpm shows:paste`); adapters and jobs in Phase 3.
export { applyPlan, commitPaste, type ApplySummary } from "./paste/apply.js";
export { parsePaste, type ParseResult, type PastedShow } from "./paste/parse.js";
export { planPaste, type Plan } from "./paste/plan.js";
