CREATE TABLE "facility_setup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_name" varchar(255) NOT NULL,
	"facility_code" varchar(50) NOT NULL,
	"telephone" varchar(20),
	"email" varchar(255),
	"address" text,
	"logo_url" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
