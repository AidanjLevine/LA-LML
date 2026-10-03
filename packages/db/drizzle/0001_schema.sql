CREATE TYPE "public"."artist_kind" AS ENUM('band', 'dj', 'solo', 'cover');--> statement-breakpoint
CREATE TYPE "public"."event_artist_role" AS ENUM('headliner', 'support', 'dj');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."proposal_target_type" AS ENUM('neighborhood', 'venue', 'artist', 'series', 'event');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'merged');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('manual', 'bulk_paste', 'venue_site', 'ticketmaster', 'flyer', 'newsletter', 'submission');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('selling_fast', 'sold_out');--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"kind" "artist_kind" NOT NULL,
	"genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"proposed_genres" text[] DEFAULT '{}'::text[] NOT NULL,
	"spotify" text,
	"bandcamp" text,
	"instagram" text,
	"facebook" text,
	"tiktok" text,
	"dice" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event_artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"billing_order" integer DEFAULT 0 NOT NULL,
	"role" "event_artist_role" NOT NULL,
	"set_start_minutes" integer,
	"stage" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_artists_event_id_artist_id_unique" UNIQUE("event_id","artist_id"),
	CONSTRAINT "event_artists_set_start_minutes_range" CHECK ("event_artists"."set_start_minutes" between 0 and 2879)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"series_id" uuid,
	"title" text,
	"local_date" date NOT NULL,
	"start_minutes" integer,
	"doors_minutes" integer,
	"end_minutes" integer,
	"is_free" boolean DEFAULT false NOT NULL,
	"age_limit" text,
	"ticket_url" text,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"ticket_status" "ticket_status",
	"hidden" boolean DEFAULT false NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_start_minutes_range" CHECK ("events"."start_minutes" between 0 and 2879),
	CONSTRAINT "events_doors_minutes_range" CHECK ("events"."doors_minutes" between 0 and 2879),
	CONSTRAINT "events_end_minutes_range" CHECK ("events"."end_minutes" between 0 and 2879)
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"cents" integer NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_cents_nonnegative" CHECK ("prices"."cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" text NOT NULL,
	"recurrence_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sources_event_id_source_record_id_unique" UNIQUE("event_id","source_record_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" "proposal_target_type" NOT NULL,
	"target_id" uuid,
	"proposed_attributes" jsonb NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"submitted_by" text,
	"reviewed_by" text,
	"reviewer_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text,
	"url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"extracted" jsonb,
	"confidence" real,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_source_id_external_id_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"trust_level" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"region" text NOT NULL,
	"boundary" geometry(Polygon, 4326),
	"center" geometry(Point, 4326) NOT NULL,
	"zoom" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "neighborhoods_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text NOT NULL,
	"neighborhood_id" uuid,
	"region" text NOT NULL,
	"time_zone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"capacity" integer,
	"age_policy" text,
	"website" text,
	"instagram" text,
	"facebook" text,
	"tiktok" text,
	"dice" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artists_name_trgm_idx" ON "artists" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "event_artists_artist_id_idx" ON "event_artists" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "events_venue_id_local_date_idx" ON "events" USING btree ("venue_id","local_date");--> statement-breakpoint
CREATE INDEX "events_local_date_idx" ON "events" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "events_series_id_idx" ON "events" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "prices_event_id_idx" ON "prices" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_sources_source_record_id_idx" ON "event_sources" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "proposals_target_idx" ON "proposals" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "source_records_content_hash_idx" ON "source_records" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "source_records_review_status_idx" ON "source_records" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "source_records_event_id_idx" ON "source_records" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "venues_location_gist_idx" ON "venues" USING gist ("location");--> statement-breakpoint
CREATE INDEX "venues_name_trgm_idx" ON "venues" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "venues_neighborhood_id_idx" ON "venues" USING btree ("neighborhood_id");