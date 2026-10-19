/** compose up 직후 Postgres와 PgBouncer가 실제로 질의를 받을 때까지 대기한다. */
import '../src/load-env.ts';
import pg from 'pg';

const { Client } = pg;
const PASSWORD = process.env.POSTGRES_PASSWORD ?? 'devpass';

async function probe(port: number, label: string) {
  const deadline = Date.now() + 90_000;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const client = new Client({
      host: process.env.PGHOST ?? '127.0.0.1',
      port,
      database: 'ai_community',
      user: 'community_owner',
      password: PASSWORD,
      connectionTimeoutMillis: 3000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      console.log(`  ready  ${label} (:${port})`);
      return;
    } catch (err) {
      lastErr = err;
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`${label} not ready: ${String(lastErr)}`);
}

await probe(Number(process.env.POSTGRES_PORT ?? 5432), 'postgres');
await probe(Number(process.env.PGBOUNCER_PORT ?? 6432), 'pgbouncer');
