# Threat model

Scope: the query path from HTTP request to Postgres rows and back. Out of
scope: the hosting platform, TLS termination, and the seed data pipeline.

## Attacker controls

- The natural-language question (arbitrary text, including prompt injection).
- Anything an LLM backend emits: SQL text, identifiers, comments, payloads
  designed to exploit the parser, the planner, or the views.
- Query complexity and volume (expensive plans, high request rates).
- All HTTP inputs: body fields, headers, tokens.

## Attacker must not obtain

- Rows outside their tenant (cross-tenant reads).
- PII or secrets (`full_name`, `email`, `products.cost`), in any tenant.
- Any write, DDL, or database metadata (`pg_*`, `information_schema`).
- Filesystem or network access from the database (`COPY`, `dblink`, `lo_*`).
- Unbounded compute (runaway plans, request floods).

## Trust boundaries

```
browser (untrusted)
  |
API route — auth resolved here from a signed token, never from client fields
  |
agent — model output treated as untrusted text
  |
SQL guard — AST allowlist, relation/column policy, LIMIT injection
  |
Postgres — RLS as the calling role, cost gate, read-only transaction
  |
audit log — append-only, runtime role can only INSERT
```

Each layer assumes the ones above it are compromised. In particular, RLS
would still filter rows correctly if the validator passed hostile SQL, and
the validator would still block hostile SQL if RLS were misconfigured.

## Deliberate mock boundary (local dev only)

Without `AUTH_SECRET` set, the API refuses every request unless
`ALLOW_MOCK_AUTH=true`, which mints context from headers for the demo UI.
That flag must never be set outside local development: header identity is
requester-controlled, so a deployed instance with mock auth on would let any
caller pick their tenant, role, and region. CI and the eval harness run with
mock auth on a throwaway embedded database only.

## Known gaps (accepted, tracked)

1. `customers` has no tenant column, so customer rows are region-scoped, not
   tenant-scoped. Two tenants in the same region see the same customer list
   (no PII either way — names and emails are ungranted). Fixing it means a
   schema + reseed change; tracked for the next batch.
2. `products`, `categories`, and `reviews` are treated as a shared catalog
   with no RLS. This is by design (no tenant column, same data for everyone),
   but any future tenant-specific attribute on these tables needs a policy
   at the same time as the column.
3. Rate limiting is in-process memory. A multi-instance deployment needs a
   shared store (Redis) before the limiter is a real abuse boundary.
4. The 40-question benchmark measures the shipped question shapes. Paraphrase
   and multi-role variants are needed before the accuracy number generalizes.
