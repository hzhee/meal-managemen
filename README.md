# Sowmy Kitchen

Production-shaped meal-management platform MVP for Sowmy Kitchen.

This implementation is intentionally more than a static restaurant website. It includes role-aware student, owner, and driver workspaces; meal preference and location management; wallet automation; holiday propagation; delivery assignment; and a production-ready PostgreSQL schema draft.

## Run locally

```bash
npm install
npm run dev -- --port 5173
```

To run the secure API, create `.env` from `.env.example`, apply `src/schema.sql` to PostgreSQL, then run:

```bash
npm run server
```

The API listens on port `8787` by default. Create the first owner account with:

```bash
npm run seed:admin -- owner@example.com +919999999999 a-long-unique-password
```

## Verify

```bash
npm run build
npm test
```

## Important production note

Razorpay is now exposed through secure backend endpoints for order creation, signature verification, and signed webhooks. Add client-owned test credentials to `.env` before using them. Wallet credit occurs only after a server-side verification and an idempotent database transaction. WhatsApp remains an explicit mock/test adapter until official provider credentials are added.
