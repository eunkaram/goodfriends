/**
 * 헬스체크 — §17.3 "자체 호스팅이 만든 숙제"의 모니터링 항목 1단계.
 *
 * 외부 uptime 모니터링(또는 향후 배포 스크립트)이 주기적으로 찔러보는
 * 용도라 인증이 없다 — DB/Redis 접속 가능 여부만 노출하고 그 외 정보는
 * 아무것도 안 준다(에러 메시지 원문도 로그로만, 응답 바디엔 안 넣는다).
 *
 * 🔒 불변식 20("appPool()/authPool()은 파일당 모듈 스코프에서 한 번만
 * 호출") — 이 파일이 자체 풀을 하나 갖는다, 다른 파일의 풀을 빌려 쓰지
 * 않는다. `community_app_exists` 역할을 쓴다 — 이 라우트는 어떤 테이블 내용도
 * 안 읽고 접속 자체만 확인하면 되니 가장 낮은 권한.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appPool, queryRaw } from './db.ts';
import { redis } from './redis.ts';
import { json } from './http-utils.ts';

const pool = appPool('exists');

const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function checkDb(): Promise<boolean> {
  try {
    await withTimeout(queryRaw(pool, 'SELECT 1'), CHECK_TIMEOUT_MS);
    return true;
  } catch (err) {
    console.error('[health] db check failed:', err);
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    await withTimeout(redis().ping(), CHECK_TIMEOUT_MS);
    return true;
  } catch (err) {
    console.error('[health] redis check failed:', err);
    return false;
  }
}

export async function handleHealthRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'GET' && url.pathname === '/api/health') {
    const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);
    const ok = dbOk && redisOk;
    json(res, ok ? 200 : 503, {
      ok,
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      uptimeSeconds: Math.floor(process.uptime()),
    });
    return true;
  }

  return false;
}
