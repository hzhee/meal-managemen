# Sowmy Kitchen

Production-shaped meal-management platform MVP for Sowmy Kitchen.

This implementation is intentionally more than a static restaurant website. It includes role-aware student, owner, and driver workspaces; meal preference and location management; wallet automation; holiday propagation; delivery assignment; and a production-ready PostgreSQL schema draft.

## Run locally

```bash
npm install
npm run dev -- --port 5173
```

## Verify

```bash
npm run build
npm test
```

## Important production note

Razorpay and WhatsApp are currently explicit mock/test adapters. Before going live, connect client-owned credentials through a backend that verifies payments and enforces database-backed authentication and role permissions.
