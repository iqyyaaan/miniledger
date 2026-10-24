-- MiniLedger initial schema.
--
-- a few things worth knowing going in:
--   * money lives in amount_minor BIGINT (paise, not rupees) — no floats
--   * "overdue" isn't a stored status, it's derived at query time from
--     (status = 'outstanding' AND due_date < today). a row just sitting in
--     the table quietly becomes overdue as the clock crosses midnight —
--     storing the flag would mean running a cron job just to keep it honest
--   * secrets (OTPs, refresh tokens) only ever get stored as SHA-256 hashes

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- keeps updated_at honest without every write path having to remember to set it
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- app normalizes phone to E.164 before it ever gets here; the DB refuses
  -- anything else so a bad code path can't quietly create a second account
  -- under a different spelling of the same number
  CONSTRAINT users_phone_is_e164 CHECK (phone ~ '^\+[1-9]\d{7,14}$')
);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- otp_codes — short-lived login challenges
-- ---------------------------------------------------------------------------
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT otp_codes_phone_is_e164 CHECK (phone ~ '^\+[1-9]\d{7,14}$')
);

-- verification always asks for "the newest unconsumed code for this phone."
-- partial index so only unconsumed rows get indexed — spent codes just pile
-- up otherwise and never actually get looked up again
CREATE INDEX otp_codes_active_idx
  ON otp_codes (phone, created_at DESC)
  WHERE consumed_at IS NULL;

-- backs the per-phone send-rate check
CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);

-- ---------------------------------------------------------------------------
-- refresh_tokens — rotating, one row per issued token
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  -- gets set when this token is rotated out, so a replay of the old one is
  -- detectable as reuse rather than just looking like an expired token
  replaced_by UUID REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- loans — the ledger itself
-- ---------------------------------------------------------------------------
CREATE TABLE loans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  friend_name  TEXT NOT NULL CHECK (length(btrim(friend_name)) BETWEEN 1 AND 80),
  -- generated column, so grouping "Ravi" with "ravi " doesn't rely on every
  -- query remembering to lower()/trim() it correctly
  friend_key   TEXT GENERATED ALWAYS AS (lower(btrim(friend_name))) STORED,

  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency     CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),

  due_date     DATE NOT NULL,
  note         TEXT CHECK (note IS NULL OR length(note) <= 500),

  status       TEXT NOT NULL DEFAULT 'outstanding'
                 CHECK (status IN ('outstanding', 'repaid')),
  repaid_at    TIMESTAMPTZ,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- these two fields have to agree — repaid rows carry a timestamp, open
  -- ones don't. the summary query depends on that invariant holding, so
  -- putting it in the database means no future code path can get it wrong.
  CONSTRAINT loans_repaid_consistency CHECK (
    (status = 'repaid'      AND repaid_at IS NOT NULL) OR
    (status = 'outstanding' AND repaid_at IS NULL)
  )
);

CREATE TRIGGER loans_set_updated_at
  BEFORE UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- every list query is scoped to one user and sorted by due date
CREATE INDEX loans_user_due_idx ON loans (user_id, due_date DESC, created_at DESC);
-- overdue/outstanding filters only ever need to scan open rows
CREATE INDEX loans_user_outstanding_idx
  ON loans (user_id, due_date)
  WHERE status = 'outstanding';
-- friend autocomplete + per-friend grouping in the summary
CREATE INDEX loans_user_friend_idx ON loans (user_id, friend_key);

-- ---------------------------------------------------------------------------
-- receipts — optional photo attached to a loan
-- ---------------------------------------------------------------------------
CREATE TABLE receipts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id       UUID NOT NULL UNIQUE REFERENCES loans (id) ON DELETE CASCADE, -- one receipt per loan, re-upload replaces it
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key   TEXT NOT NULL,
  mime_type     TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  original_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX receipts_user_idx ON receipts (user_id);
