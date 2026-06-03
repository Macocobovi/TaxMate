---
name: taxmate-dev
description: Use this skill when implementing or refining Taxmate fullstack features, backend integrations, and template-aligned frontend pages. Enforces Circle + Monnify + VerifyMe architecture, PostgreSQL with Drizzle, and llm.md context updates.
---

# Taxmate Development Skill

## When to use
- Any request to build Taxmate backend/frontend features.
- Any request touching Circle wallets/gasless contract execution, Monnify payments, VerifyMe identity flows, Pinata receipts, or queue processing.
- Any request to continue previous work from project context.

## Mandatory sequence
1. Read `llm.md` first for current state, blockers, and next tasks.
2. Keep frontend aligned to existing template components (`frontend/src/components/layout/*`).
3. Use `backend/` Express + TypeScript + Drizzle stack (never Prisma).
4. Keep contract calls aligned with `proxy-contract/contracts/Taxmate.sol` signatures.
5. After meaningful progress, run `ops/scripts/update-llm-context.sh`.

## Backend constraints
- API prefix: `/api`
- Required modules: `auth`, `identity`, `user`, `tax-items`, `payments`, `admin`, `health`
- PostgreSQL only (Drizzle schema + migrations)
- Queue names: `wallet-creation`, `business-verification-poll`, `on-chain-payment`, `tax-item-sync`, `email-send`, `invoice-expiry`

## Integration contracts
- VerifyMe base URL: `https://vapi.verifyme.ng`
- Monnify base URL: `https://api.monnify.com`
- Circle base URL: `https://api.circle.com`
- Pinata gateway: from `PINATA_GATEWAY_URL`

## Validation checklist
- `npm run typecheck --workspace backend`
- `npm run lint --workspace backend`
- `npm run lint --workspace frontend`
- Confirm navigation routes resolve (`/register`, `/login`, `/dashboard/*`, `/admin`)

## Output hygiene
- Never commit secrets.
- Keep context in `llm.md` concise and timestamped.
- Preserve existing dashboard style and spacing rhythm.
