# @lalml/ingest

Ingestion adapters and scheduled jobs. Empty for now.

Every adapter does two steps:

1. **Fetch**: store each raw item in `source_records` with a content hash.
2. **Parse**: turn each record into a candidate event.

A shared pipeline then matches venues and artists (fuzzy match plus aliases), dedupes (same venue, start within two hours, overlapping lineup), and routes the result: trusted, clean items publish; anything uncertain becomes a proposal for review. Ingestion never writes canonical tables directly.

Planned adapters: manual entry and bulk paste (Phase 1), Ticketmaster and venue websites (Phase 3), flyers and newsletters (Phase 4). Jobs run nightly on GitHub Actions. See `docs/PLAN.md`.
