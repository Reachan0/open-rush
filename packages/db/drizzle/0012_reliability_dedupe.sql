CREATE TABLE "reliability_event_ids" (
	"event_id" varchar(128) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reliability_cursors" (
	"experiment_id" varchar(255) PRIMARY KEY NOT NULL,
	"source_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
