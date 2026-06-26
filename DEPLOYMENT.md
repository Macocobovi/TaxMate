# Taxmate — Deployment Guide

Production deployment of Taxmate across **Vercel** (frontend) and **Render** (backend + Postgres), with the smart contract on **Base**.

```
  Browser ──► Vercel (Next.js frontend)
                  │  NEXT_PUBLIC_API_URL
                  ▼
            Render Web Service (Express API + in-process on-chain recording)
              ├── Render Postgres        (DATABASE_URL)
              ├── Circle  (custodial wallets + on-chain writes)
              ├── Monnify (payments + webhook)
              ├── Pinata  (IPFS receipts)
              ├── Resend  (email/OTP)
              └── VerifyMe (KYC)
                  │
                  ▼
            Base chain (Taxmate contract)
```

---

## 0. Prerequisites

- Accounts: **Vercel**, **Render**, **Monnify**, **Circle** (developer-controlled wallets), **Pinata**, **Resend** (with a verified sending domain), and **VerifyMe** (optional — mock mode works without it).
- A **deployed Taxmate contract** on Base (Sepolia for staging, Mainnet for production) and the **Circle admin wallet granted `SUB_ADMIN_ROLE`** on it.
- The frontend lives in its **own repo** (`Taxmateng/frontend`); the backend + contracts live in the monorepo (`Taxmateng/proxy-contract`, backend under `backend/`).

---

## Part A — Smart contract (one-time, per environment)

From `proxy-contract/` (see `proxy-contract/.env`):

```bash
npm run deploy:base-sepolia            # or deploy:base-mainnet
npm run verify:base-sepolia -- <ADDRESS>
# Grant the Circle admin wallet SUB_ADMIN_ROLE (required for recordTaxPayment / createTaxItem):
SUBADMIN_ADDRESS=<circle-admin-wallet-address> \
  npx hardhat run scripts/provision-admin.ts --network baseSepolia
```

Record the deployed **contract address** — it becomes `TAXMATE_CONTRACT_ADDRESS` on the backend. Tax items are created on-chain lazily at first invoice (`ensureTaxItemOnChain`) or by an admin in the dashboard — no manual seeding needed.

---

## Part B — Backend on Render

### B.1 Create the data store
1. **Render Postgres** → copy its **Internal Database URL** → `DATABASE_URL`.
   > Redis is **not required** — on-chain recording runs in-process and is re-driven by the polled `/verify` endpoint and the admin retry action. (`REDIS_URL` is optional and currently unused.)

### B.2 Create the Web Service
- **Repository:** `Taxmateng/proxy-contract`
- **Root Directory:** `backend`
- **Runtime:** Node (20+)
- **Build Command:** `npm install && npm run build`
  > `npm run build` runs `tsc` then a `postbuild` step that copies the runtime assets (`src/mocks/*.json`, `assets/taxmate-stamp.png`) into `dist/`. This copy is **required** — the backend loads `mocks/tins.json` eagerly at startup, so a build without it crashes the server. (Already wired in `backend/package.json`.)
- **Start Command:** `npm start`  (`node dist/server.js`)
- **Health Check Path:** `/api/health`
- **Instances:** **1**. On-chain recording and rate-limit state are in-process, so run a single instance. A **paid (always-on)** instance is recommended so recording continues even when no one is polling; free instances hibernate and only advance recording while the page/admin is polling.

### B.3 Run the database migration
The schema is not auto-applied. Run once (and after schema changes) — as a Render **Pre-Deploy Command** or a one-off shell:
```bash
npm run db:migrate            # drizzle-kit push, uses DATABASE_URL
```

### B.4 Backend environment variables
See the [full reference](#backend-env-reference) below. Minimum to boot: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEXT_PUBLIC_APP_URL`. Set `NODE_ENV=production`.

### B.5 Post-deploy
1. **Create the super-admin** (against the prod DB) — one-off shell on the service:
   ```bash
   SUPERADMIN_EMAIL='admin@taxmate.ng' SUPERADMIN_PASSWORD='<strong-password>' \
     npm run admin:create-superadmin
   ```
2. **Set the Monnify webhook** (dashboard → Webhooks → *Transaction completion*) to:
   ```
   https://<your-render-service>.onrender.com/api/payments/monnify/webhook
   ```
   It must be public HTTPS; signature is verified with `MONNIFY_SECRET_KEY`.

---

## Part C — Frontend on Vercel

Deploy the **`Taxmateng/frontend`** repo directly (it's standalone — not the monorepo).

- **Framework preset:** Next.js (auto-detected)
- **Root Directory:** repo root
- **Build Command / Output:** defaults (`next build`)
- **Environment variables:** see [frontend reference](#frontend-env-reference).

After the first deploy, take the Vercel URL (e.g. `https://taxmate.vercel.app`) and set it as **`NEXT_PUBLIC_APP_URL` on the backend** (used for CORS allow-origin, the Monnify redirect URL, and the email logo). Redeploy the backend so CORS accepts the frontend origin.

---

## Backend env reference

Set on the Render service. (Schema/validation: `backend/src/config/env.ts`.)

### Core (required)
| Var | Example / notes |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Render injects this; app defaults to 4000 |
| `API_PREFIX` | `/api` (default) |
| `DATABASE_URL` | Render Postgres internal URL |
| `REDIS_URL` | optional / unused (on-chain recording runs in-process) |
| `JWT_SECRET` | long random string |
| `JWT_REFRESH_SECRET` | long random string (different) |
| `NEXT_PUBLIC_APP_URL` | the **Vercel frontend URL** (CORS origin + redirect + email logo) |

### Blockchain / on-chain reads
| Var | Notes |
|---|---|
| `TAXMATE_CONTRACT_ADDRESS` | deployed contract address |
| `BASE_RPC_URL` | Base RPC (e.g. `https://sepolia.base.org` or an Alchemy/Infura URL) |
| `EXPLORER_URL` | optional, default `https://sepolia.basescan.org` (use `https://basescan.org` on mainnet) |

### Circle (custodial wallets + on-chain writes)
| Var | Notes |
|---|---|
| `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` | required for real on-chain writes |
| `CIRCLE_WALLET_SET_ID` | wallet set used to create taxpayer wallets |
| `CIRCLE_ADMIN_WALLET_ID` | the admin wallet that signs `recordTaxPayment`/`createTaxItem` (must hold `SUB_ADMIN_ROLE`) |
| `CIRCLE_BASE_URL` | default `https://api.circle.com` |

### Monnify (payments)
| Var | Notes |
|---|---|
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE` | **all three required** for live payments |
| `MONNIFY_BASE_URL` | `https://api.monnify.com` (prod) or `https://sandbox.monnify.com` |

### Pinata / Resend / VerifyMe
| Var | Notes |
|---|---|
| `PINATA_JWT` | active account; else receipts fall back to a stub CID (dev only) |
| `PINATA_GATEWAY_URL` | default `https://gateway.pinata.cloud/ipfs` |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | from-address domain must be verified on Resend |
| `VERIFYME_API_KEY` | omit to run KYC in **mock mode**; set to use the real API |
| `VERIFYME_BASE_URL` | default `https://vapi.verifyme.ng` |

If an integration's keys are omitted it runs in a safe mock/stub mode (good for a demo deploy), **except** `DATABASE_URL` which is always required.

---

## Frontend env reference

Set on the Vercel project (all build-time `NEXT_PUBLIC_*`).

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | the Render backend URL **+ `/api`**, e.g. `https://taxmate-api.onrender.com/api` |
| `NEXT_PUBLIC_EXPLORER_URL` | `https://sepolia.basescan.org` (or `https://basescan.org` on mainnet) |

---

## Critical requirements & gotchas

1. **Copy non-TS assets in the build** (Part B.2) — otherwise the backend crashes (missing `mocks/tins.json`) and receipts lose the stamp.
2. **Public HTTPS webhook** — Monnify can't reach `localhost`; set the webhook to the Render URL. Active verification (`/verify`) is the fallback if a webhook is missed.
3. **CORS** — `NEXT_PUBLIC_APP_URL` (backend) must exactly match the Vercel origin (scheme + host, no trailing slash).
4. **Resend domain** must be verified, or OTP/receipt emails won't deliver.
5. **Pinata account** must be active for real IPFS receipts.
6. **Circle network must match the contract's chain** (Sepolia vs Mainnet) and the admin wallet must hold `SUB_ADMIN_ROLE`.
7. **Single backend instance** — on-chain recording, rate-limit, and mock-verification state are in-process. Prefer a **paid always-on** instance so recording isn't dependent on the page polling (free instances hibernate).
8. **Secrets** — generate strong `JWT_SECRET` / `JWT_REFRESH_SECRET`; never reuse dev values.

---

## Post-deploy smoke test

1. `GET https://<backend>/api/health` → 200.
2. Frontend loads; register a taxpayer (OTP email arrives via Resend; NIN/RC verify).
3. Create + pay an invoice (Monnify) → webhook/verify marks it `PAID` → on-chain worker flips it to `CONFIRMED` with a real tx hash → receipt PDF downloads with the stamp.
4. Log in as the super-admin → lands on `/admin`; Overview chart renders; create a tax item (real on-chain tx); audit log shows the action.
```
