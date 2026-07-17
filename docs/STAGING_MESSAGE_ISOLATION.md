# Staging message isolation evidence

Verified on 2026-07-17 against staging project `yfijluyktqfzhwfgjsbb` after migration `20260717140000_message_tenant_security.sql`.

Run `npm run test:message-isolation:staging` with staging `SUPABASE_URL`, service-role and anon keys, plus a non-production `STAGING_ISOLATION_TEST_PASSWORD`. The runner creates reserved `example.com` staff fixtures and asserts authenticated RLS behavior.

Observed result:

```json
The command also starts the backend on an ephemeral local port and proves API send `200`, history `200`, receipt of the exact sent ID, server-derived author identity, and Hillside detail denial `403`; its uniquely titled fixture is removed afterward.
```

This proves Harbor/Hillside select isolation across all 17 tables with a direct `congregation_id`, denial for a role without `communications.read`, cross-tenant insert denial, and server-compatible author identity enforcement. API routes independently require `communications.read` or `communications.write` because the backend service-role client bypasses RLS.
