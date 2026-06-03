# Taxmate LLM Context

## Current Snapshot
- Fullstack workspace includes:
  - `frontend/` Next.js template app with registration flows wired to backend.
  - `backend/` Express + TypeScript + Drizzle with VerifyMe (mock mode) and Circle integration scaffolding.
  - `proxy-contract/` Hardhat project configured for Base Sepolia/Base Mainnet.
  - `ops/` LLM skill/settings/scripts.
- Registration pipeline is implemented (OTP -> VerifyMe -> DB -> Circle wallet -> on-chain registration -> dashboard redirect), with VerifyMe mocked until live credentials are available.

## Completed
- Backend auth/identity orchestration implemented:
  - `backend/src/modules/auth/router.ts`
  - `backend/src/modules/identity/router.ts`
- OTP/session persistence and service layer:
  - `backend/src/db/schema.ts` (`otp_codes`, `registration_sessions`)
  - `backend/src/services/otp-service.ts`
  - `backend/src/services/registration-session-service.ts`
  - `backend/src/services/token-service.ts`
- VerifyMe mock mapping implemented:
  - `backend/src/mocks/verifyme-mocks.json`
  - `backend/src/integrations/verifyme.ts`
  - NIN keys: `22515263226`, `33477198210`, `44190532764`
  - RC keys: `123453`, `223344`, `778899`
- Circle setup scripts added:
  - `backend/scripts/register-circle-entity-secret.ts` (generate secret + ciphertext)
  - `backend/scripts/register-circle-ciphertext.ts` (attempt API-based ciphertext registration endpoints)
  - `backend/scripts/create-circle-wallet-set-admin.ts` (create wallet set + admin wallet)
- Circle bootstrap hardening updates:
  - Switched to fresh ciphertext generation per request (avoids `156004` reuse errors).
  - Added fallback wallet endpoint support in bootstrap script:
    - primary: `/v1/w3s/wallets`
    - fallback: `/v1/w3s/developer/wallets`
- Runtime Circle client updated to generate fresh ciphertext per request:
  - `backend/src/integrations/circle.ts`
- Contract deployment setup updated for Base Sepolia/Mainnet:
  - `proxy-contract/hardhat.config.ts`
  - `proxy-contract/scripts/deploy-taxmate.ts` with nonce retry logic
  - `proxy-contract/.env.example`

## In Progress
- Circle wallet bootstrap finalization for current project/environment endpoint variant.

## Latest Observed Errors
- Resolved:
  - `156004 Reusing an entity secret ciphertext is not allowed` by generating fresh ciphertext each request.
- Current:
  - Admin wallet creation path mismatch (`404 Resource not found`) depending on endpoint variant.
  - Script now emits both primary/fallback responses for diagnosis.

## Next Tasks
1. Re-run wallet bootstrap with patched fallback:
   - `npm run circle:create-wallet-set-admin --workspace backend`
2. If still failing, inspect both endpoint responses and adjust payload fields to the exact accepted schema for this Circle account.
3. Persist resulting values once successful:
   - `CIRCLE_WALLET_SET_ID`
   - `CIRCLE_ADMIN_WALLET_ID`
4. Continue backend hardening:
   - `/auth/refresh` token rotation
   - queue-based retries for wallet/on-chain failures
   - integration tests for unhappy paths

## Blockers
- Circle API behavior differs by account/project capability and endpoint versioning; wallet bootstrap requires endpoint/payload alignment per account.
- Backend typecheck may fail in restricted environments if dependencies are not fully installed.

## Commands
- `npm run lint --workspace frontend`
- `npm run dev --workspace backend`
- `npm run dev --workspace frontend`
- `npm run circle:register-entity-secret --workspace backend`
- `npm run circle:register-ciphertext --workspace backend`
- `npm run circle:create-wallet-set-admin --workspace backend`
- `cd proxy-contract && npm run deploy:base-sepolia`
