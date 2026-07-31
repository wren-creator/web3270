-- db/schema.sql
-- ─────────────────────────────────────────────────────────────────
-- Account/billing schema for the hosted webterm-3270.com product.
-- Applied by db/migrate.js. Plain SQL, no ORM/migration framework —
-- matches the rest of this codebase's dependency-light style.
--
-- Not used by the internal/OpenShift deployment of the bridge, which
-- has no account concept and stays on the shared config.securityPassword
-- gate. This schema only matters when BRIDGE_MULTI_TENANT is enabled.

CREATE TABLE IF NOT EXISTS accounts (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  frozen        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  email                   TEXT PRIMARY KEY REFERENCES accounts(email) ON DELETE CASCADE,
  first_name              TEXT,
  last_name               TEXT,
  phone                   TEXT,
  phone_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified          BOOLEAN NOT NULL DEFAULT FALSE,
  sku                     TEXT NOT NULL DEFAULT 'base' CHECK (sku IN ('base', 'training', 'full')),
  paypal_subscription_id  TEXT,
  -- review_status only means anything for sku='full': a paid full-tier
  -- signup starts 'pending' and is blocked from full-tier access until
  -- someone manually flips it to 'approved' after reaching out to the
  -- customer. base/training stay 'n/a' — no manual gate for those tiers.
  review_status           TEXT NOT NULL DEFAULT 'n/a' CHECK (review_status IN ('n/a', 'pending', 'approved', 'denied')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_sku ON profiles(sku);

-- Holds signup form data + phone OTP until the code is confirmed.
-- Nothing is written to accounts/profiles until verify-phone succeeds.
CREATE TABLE IF NOT EXISTS pending_signups (
  email          TEXT PRIMARY KEY,
  first_name     TEXT,
  last_name      TEXT,
  phone          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  sku            TEXT NOT NULL DEFAULT 'base' CHECK (sku IN ('base', 'training', 'full')),
  otp_code       TEXT NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generic verification-code table, reused for both post-login email
-- verification and password reset — same shape, different channel.
CREATE TABLE IF NOT EXISTS verification_codes (
  email      TEXT NOT NULL,
  channel    TEXT NOT NULL CHECK (channel IN ('email', 'password_reset')),
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (email, channel)
);

-- One row per disclaimer acceptance. Kept append-only (never updated
-- or deleted) so it stays a real record of what was agreed to and
-- when, even if the disclaimer text is revised later under a new
-- disclaimer_version.
CREATE TABLE IF NOT EXISTS disclaimer_acceptances (
  id                  SERIAL PRIMARY KEY,
  email               TEXT NOT NULL REFERENCES accounts(email) ON DELETE CASCADE,
  tier                TEXT NOT NULL,
  disclaimer_version  TEXT NOT NULL,
  accepted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_disclaimer_acceptances_email ON disclaimer_acceptances(email);
