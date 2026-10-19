/** Redis 접속 — §5.1.1 인기순 캐시 · §11.9.2 의도 보존 세션 · §9.1.1 WS 팬아웃 (§17.1) */
import './load-env.ts';
import { Redis } from 'ioredis';

let client: Redis | undefined;

export function redis(): Redis {
  client ??= new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 56379),
    password: process.env.REDIS_PASSWORD || undefined,
    lazyConnect: false,
  });
  return client;
}

export async function closeRedis() {
  await client?.quit();
  client = undefined;
}
