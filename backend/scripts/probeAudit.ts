import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/** The last N writes, with their bodies — for working out who changed what. */
(async () => {
  const rows = await db.auditLog.findMany({
    where: { method: { in: ['POST', 'PUT', 'PATCH', 'DELETE'] } },
    select: { created_at: true, method: true, path: true, status_code: true, body: true, user_agent: true },
    orderBy: { created_at: 'desc' },
    take: Number(process.argv[2] ?? 15),
  });
  for (const r of rows.reverse()) {
    const body = r.body ? JSON.stringify(r.body).slice(0, 120) : '';
    console.log(
      `${r.created_at.toISOString()}  ${r.method.padEnd(6)} ${r.status_code}  ${r.path}\n` +
      `    body: ${body}`,
    );
  }
  await db.$disconnect();
})().catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
