import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, real, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns.js";
import { proposalStatus, proposalTargetType, reviewStatus, sourceKind } from "./enums.js";
import { events } from "./events.js";

// New data enters through source_records or proposals; only admin edits write canonical tables directly.

export const sources = pgTable("sources", {
  id: id(),
  kind: sourceKind("kind").notNull(),
  name: text("name").notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  trustLevel: smallint("trust_level").notNull().default(0),
  ...timestamps,
}).enableRLS();

export const sourceRecords = pgTable(
  "source_records",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    externalId: text("external_id"),
    url: text("url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    rawPayload: jsonb("raw_payload").notNull(),
    contentHash: text("content_hash").notNull(),
    extracted: jsonb("extracted"),
    confidence: real("confidence"),
    reviewStatus: reviewStatus("review_status").notNull().default("pending"),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (t) => [
    unique("source_records_source_id_external_id_unique").on(t.sourceId, t.externalId),
    index("source_records_content_hash_idx").on(t.contentHash),
    index("source_records_review_status_idx").on(t.reviewStatus),
    index("source_records_event_id_idx").on(t.eventId),
  ],
).enableRLS();

// One event can have many sources.
export const eventSources = pgTable(
  "event_sources",
  {
    id: id(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("event_sources_event_id_source_record_id_unique").on(t.eventId, t.sourceRecordId),
    index("event_sources_source_record_id_idx").on(t.sourceRecordId),
  ],
).enableRLS();

export const proposals = pgTable(
  "proposals",
  {
    id: id(),
    targetType: proposalTargetType("target_type").notNull(),
    // Null when the proposal is for a new record.
    targetId: uuid("target_id"),
    proposedAttributes: jsonb("proposed_attributes").notNull(),
    status: proposalStatus("status").notNull().default("pending"),
    submittedBy: text("submitted_by"),
    reviewedBy: text("reviewed_by"),
    reviewerNote: text("reviewer_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("proposals_status_idx").on(t.status),
    index("proposals_target_idx").on(t.targetType, t.targetId),
  ],
).enableRLS();
