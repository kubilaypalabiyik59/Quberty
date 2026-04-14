/**
 * Jest global setup — runs before every test file.
 * Sets the minimum env vars required by config/env.ts so tests don't exit.
 */

process.env.NODE_ENV          = 'test';
process.env.DATABASE_URL      = 'postgresql://test:test@localhost:5432/test_db';
process.env.JWT_SECRET        = 'test-secret-key-for-jest-at-least-32-chars!!';
process.env.JWT_REFRESH_SECRET= 'test-refresh-secret-for-jest-at-least-32!!';
process.env.CORS_ORIGINS      = 'http://localhost:3000';
