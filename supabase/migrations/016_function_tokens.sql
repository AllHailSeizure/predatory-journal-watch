-- Hashed caller allowlist for edge functions (resolve-doi and related jobs).
-- Store only digests at rest; provisioning is handled outside this repository.

CREATE TABLE public.function_tokens (
  name          TEXT        PRIMARY KEY,
  token_sha256  TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT function_tokens_sha256_chk CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.function_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.function_tokens FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.function_tokens TO service_role;

COMMENT ON TABLE public.function_tokens IS
  'Hashed caller allowlist for edge functions. Store only digests, never raw values.';