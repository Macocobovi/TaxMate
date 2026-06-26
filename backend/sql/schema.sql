--
-- PostgreSQL database dump
--

-- Dumped from database version 15.13 (Homebrew)
-- Dumped by pg_dump version 15.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invoice_status AS ENUM (
    'PENDING',
    'PAID',
    'CONFIRMED',
    'FAILED',
    'EXPIRED'
);


--
-- Name: profile_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.profile_type AS ENUM (
    'INDIVIDUAL',
    'BUSINESS'
);


--
-- Name: role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role AS ENUM (
    'USER',
    'ADMIN',
    'SUPER_ADMIN'
);


--
-- Name: tax_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tax_category AS ENUM (
    'WHT',
    'PAYE',
    'VAT',
    'INCOME_TAX',
    'CORPORATE_TAX'
);


--
-- Name: user_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_status AS ENUM (
    'PENDING',
    'ACTIVE',
    'SUSPENDED'
);


--
-- Name: verification_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_job_status AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action character varying(100) NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id character varying(255) NOT NULL,
    metadata jsonb,
    ip_address character varying(45),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tin character varying(20) NOT NULL,
    rc_number character varying(50) NOT NULL,
    verifyme_verification_id character varying(100),
    verifyme_reference character varying(100),
    company_name character varying(255),
    company_type character varying(100),
    company_email character varying(255),
    branch_address text,
    head_office_address text,
    city character varying(100),
    lga character varying(100),
    state character varying(100),
    classification character varying(100),
    share_capital character varying(100),
    is_active boolean DEFAULT true NOT NULL,
    last_payment_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: business_verification_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_verification_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    verifyme_verification_id character varying(100) NOT NULL,
    verifyme_reference character varying(100),
    rc_number character varying(50) NOT NULL,
    status public.verification_job_status DEFAULT 'PENDING'::public.verification_job_status NOT NULL,
    result_data jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: individual_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.individual_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tin character varying(20) NOT NULL,
    nin_hash character varying(255) NOT NULL,
    firstname character varying(100),
    lastname character varying(100),
    middlename character varying(100),
    dob character varying(20),
    gender character varying(20),
    phone character varying(20),
    photo_url text,
    is_active boolean DEFAULT true NOT NULL,
    last_payment_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tax_item_cache_id uuid,
    on_chain_item_id integer NOT NULL,
    tin character varying(20) NOT NULL,
    amount numeric(15,2) NOT NULL,
    monnify_ref character varying(255) NOT NULL,
    monnify_tx_ref character varying(255),
    status public.invoice_status DEFAULT 'PENDING'::public.invoice_status NOT NULL,
    ipfs_hash character varying(255),
    tx_hash character varying(66),
    on_chain_record_id integer,
    expires_at timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: otp_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    otp_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: registration_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registration_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    session_token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tax_items_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_items_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    on_chain_item_id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category public.tax_category NOT NULL,
    rate_basis_points integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at_chain timestamp with time zone,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    email_verified_at timestamp with time zone,
    password_hash character varying(255),
    role public.role DEFAULT 'USER'::public.role NOT NULL,
    status public.user_status DEFAULT 'PENDING'::public.user_status NOT NULL,
    profile_type public.profile_type,
    wallet_address character varying(42),
    circle_wallet_id character varying(255),
    on_chain_registered boolean DEFAULT false NOT NULL,
    on_chain_tx_hash character varying(66),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_audit_logs admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: business_profiles business_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_pkey PRIMARY KEY (id);


--
-- Name: business_profiles business_profiles_rc_number_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_rc_number_unique UNIQUE (rc_number);


--
-- Name: business_profiles business_profiles_tin_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_tin_unique UNIQUE (tin);


--
-- Name: business_verification_jobs business_verification_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verification_jobs
    ADD CONSTRAINT business_verification_jobs_pkey PRIMARY KEY (id);


--
-- Name: individual_profiles individual_profiles_nin_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_profiles
    ADD CONSTRAINT individual_profiles_nin_hash_unique UNIQUE (nin_hash);


--
-- Name: individual_profiles individual_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_profiles
    ADD CONSTRAINT individual_profiles_pkey PRIMARY KEY (id);


--
-- Name: individual_profiles individual_profiles_tin_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_profiles
    ADD CONSTRAINT individual_profiles_tin_unique UNIQUE (tin);


--
-- Name: invoices invoices_monnify_ref_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_monnify_ref_unique UNIQUE (monnify_ref);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: otp_codes otp_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_codes
    ADD CONSTRAINT otp_codes_pkey PRIMARY KEY (id);


--
-- Name: registration_sessions registration_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_sessions
    ADD CONSTRAINT registration_sessions_pkey PRIMARY KEY (id);


--
-- Name: registration_sessions registration_sessions_session_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registration_sessions
    ADD CONSTRAINT registration_sessions_session_token_hash_unique UNIQUE (session_token_hash);


--
-- Name: tax_items_cache tax_items_cache_on_chain_item_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_items_cache
    ADD CONSTRAINT tax_items_cache_on_chain_item_id_unique UNIQUE (on_chain_item_id);


--
-- Name: tax_items_cache tax_items_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_items_cache
    ADD CONSTRAINT tax_items_cache_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: admin_audit_logs admin_audit_logs_admin_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_logs
    ADD CONSTRAINT admin_audit_logs_admin_id_users_id_fk FOREIGN KEY (admin_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: business_profiles business_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_profiles
    ADD CONSTRAINT business_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: business_verification_jobs business_verification_jobs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_verification_jobs
    ADD CONSTRAINT business_verification_jobs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: individual_profiles individual_profiles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.individual_profiles
    ADD CONSTRAINT individual_profiles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_tax_item_cache_id_tax_items_cache_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tax_item_cache_id_tax_items_cache_id_fk FOREIGN KEY (tax_item_cache_id) REFERENCES public.tax_items_cache(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

