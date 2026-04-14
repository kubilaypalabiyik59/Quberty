# Environment Strategy
> Based on Microsoft Dynamics 365 ALM three-tier model

## Environment Tiers

### DEV (Development)
- **Purpose:** Feature development, local iteration
- **URL:** `localhost:3001` (backend) / `localhost:3000` (frontend)
- **Database:** Local PostgreSQL (Docker)
- **Data:** Seed data only (anonymized)
- **Access:** All developers
- **Deploy:** Manual (`npm run dev`)

### TEST / UAT (User Acceptance Testing)
- **Purpose:** Integration testing, client sign-off
- **URL:** `test-api.skarpine.app` / `test.skarpine.app`
- **Database:** Shared test DB (Railway dev instance)
- **Data:** Reset weekly with fresh seed
- **Access:** QA team + client stakeholders
- **Deploy:** Auto on merge to `develop`

### PRODUCTION
- **Purpose:** Live customer data
- **URL:** `api.skarpine.app` / `app.skarpine.app`
- **Database:** Production PostgreSQL (managed, with daily backups)
- **Data:** Real data
- **Access:** Authorized deployers only
- **Deploy:** Manual trigger on tagged release

## Environment Variables Per Tier

```
.env.development
  DATABASE_URL=postgresql://localhost:5432/skarpine_dev
  NODE_ENV=development

.env.test
  DATABASE_URL=postgresql://test-server/skarpine_test
  NODE_ENV=test

.env.production
  DATABASE_URL=<Railway/Supabase production connection string>
  NODE_ENV=production
  JWT_SECRET=<strong random secret>
```

## Secrets Management
- Never commit `.env` files
- Use GitHub Secrets for CI/CD variables
- Rotate JWT secrets quarterly
- Use different secrets per environment
