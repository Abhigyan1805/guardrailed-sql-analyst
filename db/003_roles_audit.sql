-- 003_roles_audit.sql — roles (real PG) + append-only audit log
-- NOTE: PGlite runs as superuser; role statements are best-effort there.
-- On managed PG (Neon/Supabase) run this file as owner.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_reader') THEN
    CREATE ROLE app_reader NOLOGIN;
  END IF;
END $$;

-- Least privilege: reader gets SELECT on views only (run as owner on real PG)
-- GRANT CONNECT ON DATABASE shop TO app_reader;
-- GRANT USAGE ON SCHEMA public TO app_reader;
-- GRANT SELECT ON analytics_orders, analytics_customers_masked,
--   analytics_products_public, analytics_order_lines, analytics_payments TO app_reader;
-- ALTER ROLE app_reader SET statement_timeout = '2s';
-- ALTER ROLE app_reader SET default_transaction_read_only = on;

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',
  user_role TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  nl_query TEXT NOT NULL DEFAULT '',
  proposed_sql TEXT NOT NULL DEFAULT '',
  executed_sql TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW','BLOCK','CLARIFY')),
  block_stage TEXT,
  block_reason TEXT,
  confidence DOUBLE PRECISION,
  latency_ms INT,
  rows_returned INT,
  explain_cost DOUBLE PRECISION,
  tokens_in INT,
  tokens_out INT,
  cost_usd DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_decision ON audit_log(decision);
