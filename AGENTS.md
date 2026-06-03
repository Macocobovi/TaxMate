# Repository Guidelines

## Project Structure & Module Organization

This npm workspace has three packages. `frontend/` is the Next.js app: routes live in `frontend/src/app`, shared UI in `frontend/src/components`, and helpers in `frontend/src/lib`. `backend/` is the Express + TypeScript API: modules are in `backend/src/modules`, services in `backend/src/services`, middleware in `backend/src/middleware`, and Drizzle schema/migrations in `backend/src/db`. `proxy-contract/` is the Hardhat project, with Solidity sources in `contracts`, scripts in `scripts`, and tests in `test`.

## Build, Test, and Development Commands

Install dependencies from the root with `npm install`.

- `npm run dev:frontend`: start the Next.js dev server.
- `npm run dev:backend`: start the backend with `tsx watch`.
- `npm run lint:frontend`: run Next.js ESLint checks.
- `npm run lint:backend`: run backend ESLint checks.
- `npm run typecheck:backend`: check backend TypeScript without emitting files.
- `npm run build --workspace frontend`: create a production frontend build.
- `npm run build --workspace backend`: compile backend TypeScript to `dist/`.
- `npm run test --workspace backend`: run backend tests with Node's test runner.
- `npm run compile --workspace proxy-contract`: compile Solidity contracts.
- `npm run test --workspace proxy-contract`: run Hardhat contract tests.

## Coding Style & Naming Conventions

Use TypeScript ESM imports in backend code and keep import paths consistent with existing files. Follow ESLint as the source of truth; backend unused variables are warnings unless arguments are prefixed with `_`. Use 2-space indentation for TS/TSX and 4-space indentation for Solidity. Name React components in PascalCase, route folders in kebab-case, backend services as `*-service.ts`, and module routers as `router.ts`.

## Testing Guidelines

Backend tests live in `backend/tests` and use `*.test.ts` names. Contract tests live in `proxy-contract/test`; keep suites focused on one domain such as deployment, registration, tax items, payments, or getters. Add tests when changing API behavior, contract permissions, storage layout, payment logic, or signature mappings. Run relevant package tests before opening a PR.

## Commit & Pull Request Guidelines

Recent commits use Conventional Commit prefixes such as `chore:`, `fix:`, and `test:`. Keep messages imperative and scoped, for example `fix: validate tax item updates`. PRs should include a short description, tests run, linked issue or task, screenshots for frontend changes, and deployment or migration notes.

## Security & Configuration Tips

Each package has a `.env.example`; copy it to `.env` locally and never commit secrets. Use test wallets for contract deployment rehearsals. Review changes to `backend/src/config/env.ts`, `backend/src/db/migrations`, and `proxy-contract/hardhat.config.ts` carefully because they affect runtime configuration, data shape, or networks.
