# Taxmate Backend (Scaffold)

Express + TypeScript backend scaffold for Taxmate with PostgreSQL (Drizzle), queue placeholders, and integration contracts for VerifyMe, Monnify, Circle, Pinata, and Resend.

## Quick Start

1. Copy `.env.example` to `.env` and populate values.
2. Install dependencies: `npm install --workspace backend`
3. Create the database named in `DATABASE_URL` (it is not created automatically). With the default `postgresql://root@localhost:5432/taxmate`:
   ```bash
   psql "postgresql://root@localhost:5432/postgres" -c 'CREATE DATABASE taxmate;'
   ```
4. Apply the schema: `npm run db:migrate --workspace backend` (runs `drizzle-kit push`).
5. Run in dev mode: `npm run dev --workspace backend`
6. Health check: `GET http://localhost:4000/api/health`

## Scope in this scaffold

- API route skeletons for all major modules.
- Drizzle schema and initial SQL migration scaffold.
- Queue declarations for workflow orchestration.
- Contract signature map aligned with `proxy-contract/contracts/Taxmate.sol`.

Business logic is intentionally minimal and should be implemented incrementally.
