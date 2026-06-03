CREATE TYPE "public"."invoice_status" AS ENUM('PENDING', 'PAID', 'CONFIRMED', 'FAILED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."profile_type" AS ENUM('INDIVIDUAL', 'BUSINESS');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('USER', 'ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."tax_category" AS ENUM('WHT', 'PAYE', 'VAT', 'INCOME_TAX', 'CORPORATE_TAX');--> statement-breakpoint
CREATE TYPE "public"."verification_job_status" AS ENUM('PENDING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tin" varchar(20) NOT NULL,
	"rc_number" varchar(50) NOT NULL,
	"verifyme_verification_id" varchar(100),
	"verifyme_reference" varchar(100),
	"company_name" varchar(255),
	"company_type" varchar(100),
	"company_email" varchar(255),
	"branch_address" text,
	"head_office_address" text,
	"city" varchar(100),
	"lga" varchar(100),
	"state" varchar(100),
	"classification" varchar(100),
	"share_capital" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_payment_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profiles_tin_unique" UNIQUE("tin"),
	CONSTRAINT "business_profiles_rc_number_unique" UNIQUE("rc_number")
);
--> statement-breakpoint
CREATE TABLE "business_verification_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"verifyme_verification_id" varchar(100) NOT NULL,
	"verifyme_reference" varchar(100),
	"rc_number" varchar(50) NOT NULL,
	"status" "verification_job_status" DEFAULT 'PENDING' NOT NULL,
	"result_data" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "individual_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tin" varchar(20) NOT NULL,
	"nin_hash" varchar(255) NOT NULL,
	"firstname" varchar(100),
	"lastname" varchar(100),
	"middlename" varchar(100),
	"dob" varchar(20),
	"gender" varchar(20),
	"phone" varchar(20),
	"photo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_payment_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "individual_profiles_tin_unique" UNIQUE("tin"),
	CONSTRAINT "individual_profiles_nin_hash_unique" UNIQUE("nin_hash")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tax_item_cache_id" uuid,
	"on_chain_item_id" integer NOT NULL,
	"tin" varchar(20) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"monnify_ref" varchar(255) NOT NULL,
	"monnify_tx_ref" varchar(255),
	"status" "invoice_status" DEFAULT 'PENDING' NOT NULL,
	"ipfs_hash" varchar(255),
	"tx_hash" varchar(66),
	"on_chain_record_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_monnify_ref_unique" UNIQUE("monnify_ref")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"otp_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"session_token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "tax_items_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"on_chain_item_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"category" "tax_category" NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at_chain" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_items_cache_on_chain_item_id_unique" UNIQUE("on_chain_item_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" varchar(255),
	"role" "role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'PENDING' NOT NULL,
	"profile_type" "profile_type",
	"wallet_address" varchar(42),
	"circle_wallet_id" varchar(255),
	"on_chain_registered" boolean DEFAULT false NOT NULL,
	"on_chain_tx_hash" varchar(66),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_verification_jobs" ADD CONSTRAINT "business_verification_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_profiles" ADD CONSTRAINT "individual_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_item_cache_id_tax_items_cache_id_fk" FOREIGN KEY ("tax_item_cache_id") REFERENCES "public"."tax_items_cache"("id") ON DELETE set null ON UPDATE no action;