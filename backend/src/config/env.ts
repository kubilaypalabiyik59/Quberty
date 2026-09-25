import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  /**
   * Minutes without user activity after which a workforce session is ended.
   * Deployment-level for now; its permanent home is a tenant security
   * parameter, which lands with the session work of WORK-052 (migration 042).
   */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(10),
  CORS_ORIGINS: z.string().transform((s) => s.split(',')),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),
  FAL_API_KEY: z.string().optional(),
  ONEPROVIDER_API_KEY: z.string().optional(),
  ONEPROVIDER_IMAGE_MODEL: z.string().optional(),
  ONEPROVIDER_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'auto']).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
