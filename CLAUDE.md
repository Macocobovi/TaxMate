# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Taxmate is a Nigerian on-chain tax-payment system. It is an npm workspace with three packages: `frontend/` (Next.js, **a git submodule** pointing to `Taxmateng/frontend` — run `git submodule update --init` after cloning), `backend/` (Express + TypeScript + Drizzle/Postgres), and `proxy-contract/` (Hardhat + Solidity, UUPS upgradeable). See `AGENTS.md` for coding-style and PR conventions; `llm.md` tracks live work-in-progress state (notably Circle wallet bootstrap).

## Commands

Install once from the root: `npm install`.

Root workspace shortcuts:
- `npm run dev:backend` / `npm run dev:frontend` — start dev servers
- `npm run lint:backend` / `npm run lint:frontend`
- `npm run typecheck:backend`

Backend (`--workspace backend`, or `cd backend`):
- `npm run test` — runs all tests via `tsx --test tests/**/*.test.ts` (Node test runner)
- Run a single test file: `cd backend && npx tsx --test tests/auth-support.test.ts`
- `npm run db:generate` (drizzle-kit generate) / `npm run db:migrate` (drizzle-kit push)
- `npm run circle:*` — one-time Circle wallet/entity-secret bootstrap scripts (see `llm.md` for sequence)

Contracts (`--workspace proxy-contract`, or `cd proxy-contract`):
- `npm run compile`, `npm run test` (Hardhat runs the Solidity `*.t.sol` Foundry-style tests in `test/`)
- `npm run deploy:base-sepolia` / `npm run deploy:base-mainnet` (Base Sepolia chainId 84532 / Base mainnet 8453)

Each package has its own `.env.example` — copy to `.env`. Backend env is validated by Zod in `backend/src/config/env.ts`; a missing required var (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEXT_PUBLIC_APP_URL`) throws at startup.

## Architecture

**The core flow is custodial-wallet registration orchestration, not direct user wallets.** Users never hold keys. The backend drives a multi-step pipeline (in `backend/src/modules/auth/router.ts` `/register/individual` and `/register/business`):

1. Email OTP → `otp-service` issues a code; `/verify-otp` mints a short-lived `registrationSessionToken` (`registration-session-service`). Most identity/registration endpoints require a valid session token, not a JWT.
2. Identity verification via `verifyme.ts` (NIN for individuals, RC for businesses). **VerifyMe runs in mock mode** keyed off `backend/src/mocks/verifyme-mocks.json` until live credentials exist.
3. TIN reservation (`tin-service`, backed by `mocks/tins.json`).
4. Circle developer-controlled wallet creation (`integrations/circle.ts` `createScaWallet`), persisted to the user row.
5. On-chain registration: the backend calls `circleClient.executeContract(...)` against the deployed Taxmate contract, then records `onChainTxHash` / `onChainRegistered`.

**Contract-signature coupling.** `backend/src/blockchain/taxmateContract.ts` holds exact ABI function signatures (`registerTaxpayer`, `registerBusiness`, `recordTaxPayment`, `createTaxItem`, `updateTaxItem`) and a `circleExecutionMap`. Circle's `executeContract` calls the chain *by signature string + args*, so these strings must stay byte-for-byte aligned with `proxy-contract/contracts/Taxmate.sol`. `backend/tests/contract-signatures.test.ts` guards this — if you change a contract function's signature, update the map and that test together.

**Circle gotcha:** entity-secret ciphertext must be regenerated per request (reuse → error `156004`). The runtime client already does this; preserve that behavior.

**Database is a cache/index over chain state, not the source of truth for tax data.** `backend/src/db/schema.ts` (Drizzle, Postgres): `users` + `individual_profiles`/`business_profiles` hold off-chain PII and wallet linkage; `tax_items_cache` and `invoices` mirror on-chain items/payments (`onChainItemId`, `txHash`, `onChainRecordId`). Money amounts use `numeric`; never floats. Migrations live in `backend/src/db/migrations`.

**Express app wiring** (`backend/src/app.ts`): routers under `API_PREFIX` (`/api`). `/user`, `/tax-items`, `/admin` are behind `requireAuth`; `/auth`, `/identity`, `/payments` are not (they gate on session tokens or webhooks instead). Modules follow `modules/<name>/router.ts`; cross-cutting logic lives in `services/*-service.ts` and `integrations/*.ts` (Circle, VerifyMe, Monnify payments, Pinata IPFS receipts, Resend email). Queues are declared in `queues/` (BullMQ/Redis) for async wallet/on-chain retries.

**Contract** (`proxy-contract/contracts/Taxmate.sol`): UUPS-upgradeable, OpenZeppelin AccessControl with `SUPER_ADMIN_ROLE` / `SUB_ADMIN_ROLE` / `TAX_PAYER_ROLE`. Shared types/errors/events are split into `contracts/lib/{TaxTypes,Errors,Events}.sol`. Because it is upgradeable, **storage layout is append-only** — never reorder or remove state variables. Tax rates are basis points (1% = 100). Tests in `test/` are organized by domain (Deployment, Registeration, TaxItem, TaxPayment, GetterFunctions).
