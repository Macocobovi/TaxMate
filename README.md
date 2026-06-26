# Taxmate

A Nigerian on-chain tax-payment platform. Users register with verified identity, are issued a **custodial smart-contract wallet** (Circle — they never hold keys), pay tax through a Nigerian payment gateway (Monnify), and every confirmed payment is recorded as a tamper-evident receipt: pinned to **IPFS** (Pinata) and written to the **Taxmate smart contract** on Base.

This is an npm workspace with three packages:

| Package | Stack | Role |
|---|---|---|
| `frontend/` | Next.js 16, React 19, Tailwind v4 | Dashboard + registration UI. **A git submodule** (`Taxmateng/frontend`). |
| `backend/` | Express 5, TypeScript (ESM), Drizzle ORM, PostgreSQL, BullMQ/Redis | API, orchestration, on-chain writes via Circle, payment reconciliation. |
| `proxy-contract/` | Hardhat 3, Solidity 0.8.28, OpenZeppelin (UUPS) | The `Taxmate` contract: taxpayer registry, tax-item catalogue, payment records. |

The deployed contract on **Base Sepolia** (chainId 84532) is `0x52D3c0E7AB127081FE8728Caf58c10Ed4a598d27`.

---

## Prerequisites

- **Node.js** 20.11+ (developed on 24)
- **PostgreSQL** 14+ running locally
- **npm** 10+

> Redis is no longer required — on-chain recording runs in-process. `REDIS_URL` is optional/unused.
- Accounts/keys for the integrations you want live: Monnify, Circle, Pinata, Resend, VerifyMe (all degrade to mock/stub mode in dev when unset — see [Integrations](#integrations)).

---

## First-time setup

```bash
# 1. Clone with the frontend submodule
git clone <repo-url> taxmate
cd taxmate
git submodule update --init --recursive      # pulls frontend/

# 2. Install dependencies (see "Install notes" below if anything breaks)
npm install                                   # root workspaces (backend, proxy-contract)
cd frontend && npm install && cd ..           # submodule has its own lockfile

# 3. Environment files — copy and fill each package's example
cp backend/.env.example backend/.env
cp proxy-contract/.env.example proxy-contract/.env
# frontend reads NEXT_PUBLIC_* (see frontend/.env.local if present)

# 4. Create the Postgres database named in DATABASE_URL (NOT auto-created)
psql "postgresql://root@localhost:5432/postgres" -c 'CREATE DATABASE taxmate;'

# 5. Apply the schema
npm run db:migrate --workspace backend        # drizzle-kit push
```

### Install notes (important)

`frontend/` and `proxy-contract/` each manage their **own** `node_modules`/lockfiles, so a root `npm install` can leave them inconsistent:

- **frontend** is a git submodule — install it in place: `cd frontend && npm install`.
- **proxy-contract** — if Hardhat fails with a `@noble/curves` resolution error, reinstall it in isolation: `cd proxy-contract && rm -rf node_modules && npm install --workspaces=false`.
- **backend** — if a dependency install ever breaks the Circle SDK import under `tsx`, do a clean isolated reinstall: `cd backend && rm -rf node_modules && npm install --workspaces=false`.

---

## Running the app

From the repo root (each in its own terminal):

```bash
npm run dev:backend       # Express API → http://localhost:4000/api   (also starts BullMQ workers)
npm run dev:frontend      # Next.js     → http://localhost:3000
```

Health check: `GET http://localhost:4000/api/health`.

Default ports: frontend `3000`, backend `4000`, Postgres `5432`, Redis `6379`. The API prefix is `/api`.

---

## Common commands

### Backend (`--workspace backend`, or `cd backend`)

```bash
npm run dev                  # tsx watch (api + workers)
npm run build                # tsc -> dist/
npm run start                # node dist/server.js
npm run typecheck            # tsc --noEmit
npm run lint                 # eslint
npm run test                 # node test runner: tsx --test tests/**/*.test.ts
npm run db:generate          # drizzle-kit generate (create migration from schema)
npm run db:migrate           # drizzle-kit push (apply schema to DB)
# Run a single test file:
npx tsx --test tests/auth-support.test.ts
```

### Frontend (`cd frontend`)

```bash
npm run dev                  # next dev
npm run build                # next build
npm run lint                 # eslint
```

### Contracts (`cd proxy-contract`)

```bash
npm run compile                              # hardhat compile
npm run test                                 # hardhat test (Solidity *.t.sol)
npm run deploy:base-sepolia                  # deploy + initialize on Base Sepolia
npm run verify:base-sepolia -- <ADDRESS>     # verify on Basescan
# Grant SUB_ADMIN_ROLE to a wallet (e.g. the Circle admin wallet):
SUBADMIN_ADDRESS=0x... npx hardhat run scripts/provision-admin.ts --network baseSepolia
```

---

## Architecture & flows

The database is an **index/cache over chain state**, not the source of truth for tax data. Registration and payment records live on-chain; Postgres mirrors them (`tax_items_cache`, `invoices`, `on_chain_*` columns) and holds off-chain PII.

### Registration (custodial)

Users never hold keys. `backend/src/modules/auth/router.ts` orchestrates:

1. **Email OTP** — `send-otp` → `verify-otp` mints a short-lived `registrationSessionToken`.
2. **Identity** — VerifyMe (NIN for individuals, RC for businesses; mocked in dev).
3. **TIN** — auto-reserved from `tax_items`/`tins` mock pool.
4. **Wallet** — a Circle developer-controlled SCA wallet is created and linked.
5. **On-chain** — `registerTaxpayer` is executed via Circle; `tinToAddress[tin]` is set.

### Payment cycle

The catalogue (`tax_items_cache`) is mirrored from on-chain tax items. Paying:

1. **Create invoice** — `POST /api/payments/invoice`
   - `ensureTaxItemOnChain()` first **creates the tax item on-chain if missing** (in ascending id order so the contract's auto-incremented ids stay aligned with the cache), so the later on-chain recording can't revert on a missing item.
   - Inserts a `PENDING` invoice, then calls Monnify `init-transaction` → returns a `checkoutUrl`.
2. **Pay** — the user completes payment on Monnify's hosted checkout.
3. **Confirm** — two independent paths mark the invoice `PAID`, then enqueue the on-chain job:
   - **Webhook** — `POST /api/payments/monnify/webhook` (HMAC-SHA512 verified).
   - **Active verification** — `POST /api/payments/invoice/:id/verify` queries Monnify's transaction-status API and reconciles. This is webhook-independent (essential locally, where Monnify can't reach `localhost`) and a production safety net.
4. **Record on-chain** — the `on-chain-payment` BullMQ worker pins the IPFS receipt and calls `recordTaxPayment(...)` from the **admin** wallet (5 attempts, exponential backoff, idempotent), then flips the invoice to `CONFIRMED` with the tx hash.

Invoice lifecycle: `PENDING → PAID → CONFIRMED` (or `FAILED` / `EXPIRED`). On-chain amounts are recorded in **kobo** (naira × 100) since the contract takes a `uint256`.

### Contract-signature coupling

`backend/src/blockchain/taxmateContract.ts` holds exact ABI function signatures and a `circleExecutionMap`. Circle executes by signature string, so these must stay byte-aligned with `proxy-contract/contracts/Taxmate.sol`. `backend/tests/contract-signatures.test.ts` guards this — change them together.

### Contract roles

UUPS-upgradeable, OpenZeppelin AccessControl: `SUPER_ADMIN_ROLE` / `SUB_ADMIN_ROLE` / `TAX_PAYER_ROLE`. `recordTaxPayment`, `createTaxItem`, `updateTaxItem` are `onlySubAdmin`; the Circle admin wallet must hold `SUB_ADMIN_ROLE` (see [Contract provisioning](#contract-provisioning)). Because it's upgradeable, **storage layout is append-only** — never reorder/remove state variables. Tax rates are basis points (1% = 100).

---

## Contract provisioning

A freshly deployed contract needs two things before payments can be recorded on-chain:

1. **Grant the Circle admin wallet `SUB_ADMIN_ROLE`** (run by the super-admin / deployer key):
   ```bash
   cd proxy-contract
   SUBADMIN_ADDRESS=<circle-admin-wallet-address> \
     npx hardhat run scripts/provision-admin.ts --network baseSepolia
   ```
   The script is idempotent and verifies the caller actually holds `SUPER_ADMIN_ROLE`.

2. **Tax items** are created **lazily on-chain at invoice creation** (`ensureTaxItemOnChain`), so no separate seeding step is required — the first invoice for an item provisions it (and any lower-id items) on-chain.

---

## Integrations

Each integration runs in a **mock/stub mode** when its credentials are absent, so the app is fully runnable locally without them. Configure them in `backend/.env`.

| Integration | Env | Notes |
|---|---|---|
| **Circle** (wallets + on-chain writes) | `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`, `CIRCLE_ADMIN_WALLET_ID` | Developer-controlled wallets. The admin wallet must hold `SUB_ADMIN_ROLE`. |
| **Monnify** (payments) | `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_BASE_URL` | **All three of key/secret/contract-code are required** for live mode. Use `https://sandbox.monnify.com` with `MK_TEST_…` keys for dev. |
| **Pinata** (IPFS receipts) | `PINATA_JWT`, `PINATA_GATEWAY_URL` | v3 files API. In dev, a failed pin falls back to a stub CID (warned) so a disabled account doesn't block testing. |
| **Resend** (email/OTP) | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Send-from domain must be verified on Resend. |
| **VerifyMe** (KYC) | `VERIFYME_API_KEY`, `VERIFYME_BASE_URL` | Mocked via `backend/src/mocks/verifyme-mocks.json` until live. |

On-chain reads (tax-item existence, assigned ids) use `BASE_RPC_URL` + `TAXMATE_CONTRACT_ADDRESS`.

### Testing payments in dev

- **Use Monnify sandbox test credentials** — a real card 500s on Monnify's side. Test card `4111 1111 1111 1111`, CVV `122`, PIN `1234`, OTP `123456` (see [Monnify test cards](https://developers.monnify.com/docs/test-cards)), or use **Pay with Transfer**.
- **Monnify webhooks can't reach `localhost`.** The app reconciles via the verify endpoint instead, so payments still complete locally. For real push webhooks, expose the backend (`ngrok http 4000`) and set the webhook URL in the Monnify dashboard to `https://<tunnel>/api/payments/monnify/webhook`.
- Non-production responses include a `debugOtp` so you can complete the OTP step without live email.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `database "taxmate" does not exist` | Create it: `psql .../postgres -c 'CREATE DATABASE taxmate;'`, then `npm run db:migrate --workspace backend`. |
| BullMQ `ECONNREFUSED 6379` / payments stuck | Redis isn't running: `redis-server --daemonize yes`. |
| OTP "sent" but no email | Resend not configured or domain unverified; in dev use the `debugOtp` in the response. |
| "Payment gateway is not configured" | `MONNIFY_CONTRACT_CODE` (or key/secret) missing in `backend/.env`. |
| Paid on Monnify but invoice stays `PENDING` | Webhook can't reach `localhost`; reopen the invoice (it auto-verifies) or use the "check status" button / a tunnel. |
| Invoice stuck on "Recording on-chain" | The on-chain `recordTaxPayment` is reverting — usually the admin wallet lacks `SUB_ADMIN_ROLE` ([provision it](#contract-provisioning)) or the tax item isn't on-chain (now handled automatically at invoice creation). |
| Hardhat `@noble/curves` resolution error | `cd proxy-contract && rm -rf node_modules && npm install --workspaces=false`. |
| Circle SDK "does not provide an export" under tsx | Clean reinstall backend deps: `cd backend && rm -rf node_modules && npm install --workspaces=false`. |

---

## Repository layout

```
taxmate/
├── backend/          Express API, Drizzle schema/migrations, integrations, BullMQ workers
│   ├── src/modules/      route handlers (auth, identity, payments, tax-items, user, admin)
│   ├── src/services/     orchestration (otp, tin, sessions, on-chain tax items)
│   ├── src/integrations/ circle, monnify, pinata, resend, verifyme
│   ├── src/blockchain/   contract signatures + ethers read client
│   └── src/workers/      on-chain-payment worker
├── frontend/         Next.js app (git submodule)
├── proxy-contract/   Hardhat project (Taxmate.sol, scripts, tests)
├── ops/              LLM skill/settings/scripts
└── AGENTS.md         coding-style & PR conventions
```

See `backend/README.md` and `proxy-contract/README.md` for package-specific detail, and `AGENTS.md` for contribution conventions.
