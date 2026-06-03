CREATE TYPE role AS ENUM ('USER', 'ADMIN', 'SUPER_ADMIN');
CREATE TYPE user_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE profile_type AS ENUM ('INDIVIDUAL', 'BUSINESS');
CREATE TYPE invoice_status AS ENUM ('PENDING', 'PAID', 'CONFIRMED', 'FAILED', 'EXPIRED');
CREATE TYPE verification_job_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE tax_category AS ENUM ('WHT', 'PAYE', 'VAT', 'INCOME_TAX', 'CORPORATE_TAX');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at TIMESTAMPTZ,
  password_hash VARCHAR(255),
  role role NOT NULL DEFAULT 'USER',
  status user_status NOT NULL DEFAULT 'PENDING',
  profile_type profile_type,
  wallet_address VARCHAR(42),
  circle_wallet_id VARCHAR(255),
  on_chain_registered BOOLEAN NOT NULL DEFAULT FALSE,
  on_chain_tx_hash VARCHAR(66),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE individual_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tin VARCHAR(20) UNIQUE NOT NULL,
  nin_hash VARCHAR(255) UNIQUE NOT NULL,
  firstname VARCHAR(100),
  lastname VARCHAR(100),
  middlename VARCHAR(100),
  dob VARCHAR(20),
  gender VARCHAR(20),
  phone VARCHAR(20),
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_payment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tin VARCHAR(20) UNIQUE NOT NULL,
  rc_number VARCHAR(50) UNIQUE NOT NULL,
  verifyme_verification_id VARCHAR(100),
  verifyme_reference VARCHAR(100),
  company_name VARCHAR(255),
  company_type VARCHAR(100),
  company_email VARCHAR(255),
  branch_address TEXT,
  head_office_address TEXT,
  city VARCHAR(100),
  lga VARCHAR(100),
  state VARCHAR(100),
  classification VARCHAR(100),
  share_capital VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_payment_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE business_verification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  verifyme_verification_id VARCHAR(100) NOT NULL,
  verifyme_reference VARCHAR(100),
  rc_number VARCHAR(50) NOT NULL,
  status verification_job_status NOT NULL DEFAULT 'PENDING',
  result_data JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE tax_items_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  on_chain_item_id INTEGER UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category tax_category NOT NULL,
  rate_basis_points INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at_chain TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_item_cache_id UUID REFERENCES tax_items_cache(id) ON DELETE SET NULL,
  on_chain_item_id INTEGER NOT NULL,
  tin VARCHAR(20) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  monnify_ref VARCHAR(255) UNIQUE NOT NULL,
  monnify_tx_ref VARCHAR(255),
  status invoice_status NOT NULL DEFAULT 'PENDING',
  ipfs_hash VARCHAR(255),
  tx_hash VARCHAR(66),
  on_chain_record_id INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255) NOT NULL,
  metadata JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE registration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  session_token_hash VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
