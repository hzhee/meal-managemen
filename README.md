# Sowmy Kitchen

Firebase-backed meal-management platform for Sowmy Kitchen.

This implementation is intentionally more than a static restaurant website. It includes role-aware student, owner, and driver workspaces; meal preference and location management; wallet automation; holiday propagation; delivery assignment; and a production-ready PostgreSQL schema draft.

## Run locally

```bash
npm install
npm run dev -- --port 5173
```

## Firebase setup

This app uses Firebase Authentication, Firestore, and Cloud Functions. No physical server/database is needed.

1. Create a Firebase project in the Firebase Console.
2. Enable **Authentication → Email/Password** and create a **Firestore** database.
3. Copy `.firebaserc.example` to `.firebaserc` and replace the project ID.
4. Copy `.env.example` to `.env`, then add the Firebase Web App values.
5. Sign in and deploy:

```bash
npm run firebase:login
npm run firebase:deploy
```

Before deploying functions, set secrets interactively (they are not stored in Git): `npx firebase-tools functions:secrets:set INITIAL_OWNER_EMAIL`, then enter the owner email. Set Razorpay and WhatsApp secrets the same way when those accounts are ready.

## Verify

```bash
npm run build
npm test
```

## Important production note

Razorpay is exposed through Firebase Cloud Functions for secure order creation, signature verification, and signed webhooks. Wallet credit occurs only after a server-side verification and an idempotent Firestore transaction.

WhatsApp Cloud API is implemented as an official, template-based integration. Configure the `WHATSAPP_*` variables, create active rows in `whatsapp_templates`, then use `npm run notifications:dispatch` from a scheduler/worker. Messages are logged, retried up to three times, and delivery/read statuses are consumed through the signed WhatsApp webhook.
