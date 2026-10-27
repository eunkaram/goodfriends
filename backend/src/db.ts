/**
 * DB 접근 계층 — PRD §4.5 권한 강제 · §9.2-bis 관계 세션 주입
 *
 * 🔒 이 파일의 규칙 두 개는 어기면 화면이 정상으로 보이면서 권한이 무너진다.
 *
 *  1. 세션 변수는 반드시 트랜잭션 안에서 set_config(..., true) 로 주입한다.
 *     세 번째 인자 true = is_local = SET LOCAL 과 동일하며 COMMIT/ROLLBACK 시 소멸한다.
 *     이것이 없으면 트랜잭션 모드 풀러에서 다음 클라이언트가 앞 사람 권한을 상속한다.
 *
 *  2. 앱은 비소유 역할로만 접속한다. community_owner 로 붙으면 FORCE ROW LEVEL SECURITY
 *     가 없는 한 정책이 적용되지 않는다.
 *
 * §9.2-bis 는 "SET 은 바인드 파라미터를 받지 못해 문자열 보간이 된다"고 경고했으나,
 * set_config() 는 일반 함수라 파라미터를 그대로 받는다. 보간을 아예 하지 않는다.
 */

import './load-env.ts'; // 🔒 아래 PORT 상수들이 .env 값을 보기 전에 먼저 로드돼야 한다
import pg from 'pg';

const { Pool } = pg;

export type RelationCtx = {
  userId: string | null;
  /** §9.2-bis-2 — 주 피드 쿼리에만 주입한다. 사이드바 위젯에는 넘기지 않는다. */
  friendIds?: string[];
  /** 차단은 거의 모든 읽기 경로에 필요하다. */
  blockedIds?: string[];
};

export type Variant = 'arrays' | 'exists';

const PGBOUNCER_PORT = Number(process.env.PGBOUNCER_PORT ?? 6432);
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT ?? 5432);
const HOST = process.env.PGHOST ?? '127.0.0.1';
// 🔒 보안 점검 발견(2026-08-22) — 예전엔 미설정 시 'devpass'(.env.example에
// 문서화된 공개 값)로 조용히 폴백했다. scripts/migrate.ts는 이 값을 매
// 실행마다 실제 DB 역할 비밀번호로 ALTER ROLE까지 해서(드리프트 방지 목적,
// 그 파일 주석 참고) — POSTGRES_PASSWORD가 실수로 비어있으면 배포 파이프라인이
// community_owner를 포함한 5개 역할 비밀번호를 전부 공개된 약한 값으로 조용히
// 덮어썼다(실제 발생 이력 있음, migrate.ts 주석 참고). .env.example이 이미
// devpass를 로컬 개발용 시작값으로 문서화해두므로, 로컬도 .env만 있으면
// 이 요구사항에 문제없다.
const PASSWORD = (() => {
  const fromEnv = process.env.POSTGRES_PASSWORD;
  if (!fromEnv) {
    throw new Error('POSTGRES_PASSWORD가 설정되지 않았습니다 — .env(.env.example 참고)를 먼저 만드세요.');
  }
  return fromEnv;
})();

/**
 * 앱 커넥션은 PgBouncer(트랜잭션 모드)를 통과한다.
 * 🔒 테스트도 반드시 이 경로를 쓴다 — 직결로 테스트하면 G1 결함이 프로덕션에서만 터진다.
 */
export function appPool(variant: Variant, opts: { direct?: boolean } = {}) {
  return new Pool({
    host: HOST,
    port: opts.direct ? POSTGRES_PORT : PGBOUNCER_PORT,
    database: 'goodfriends',
    user: `community_app_${variant}`,
    password: PASSWORD,
    max: Number(process.env.PG_POOL_MAX ?? 4),
    // 🔒 statement_timeout 을 여기 두면 안 된다. PgBouncer 트랜잭션 모드가
    //    시작 파라미터로 받아 거부한다 ("unsupported startup parameter").
    //    타임아웃이 필요하면 트랜잭션 안에서 SET LOCAL 로 건다.
  });
}

/**
 * 인증 전용 커넥션 — §6.1. auth_credentials/oauth_identities/토큰 테이블은
 * 이 역할에만 GRANT돼 있다 (0012_auth.sql) — 콘텐츠 역할(community_app_*)은
 * 절대 비밀번호 해시를 읽을 수 없다. 로그인 전이라 app.user_id 세션 주입이
 * 의미가 없으므로 withRelationCtx가 아니라 이 풀을 직접 쓴다.
 */
export function authPool() {
  return new Pool({
    host: HOST,
    port: PGBOUNCER_PORT,
    database: 'goodfriends',
    user: 'community_app_auth',
    password: PASSWORD,
    max: Number(process.env.PG_POOL_MAX ?? 4),
  });
}

/**
 * 스키마 소유자 — 마이그레이션·배치 전용. **비슈퍼유저다.**
 *
 * 🔒 FORCE ROW LEVEL SECURITY 는 슈퍼유저를 막지 못한다. 소유자가 슈퍼유저면
 *    RLS가 통째로 무력해지고, 그 상태는 화면상 아무 증상이 없다 (§4.5 함정 2).
 */
export function schemaPool() {
  return new Pool({
    host: HOST,
    port: POSTGRES_PORT,
    database: 'goodfriends',
    user: 'community_schema',
    password: PASSWORD,
    max: 4,
  });
}

/** 슈퍼유저 — 컨테이너 부트스트랩과 테스트 픽스처 전용. 앱 런타임 사용 금지. */
let ownerPoolInstance: pg.Pool | null = null;

/**
 * 🔒 실전 결함(2026-10-19, worker 스모크 실행에서 발견) — 이전엔 호출마다 new Pool
 * 을 돌려줬다. worker/news-bot.ts가 아이템마다 ownerPool()을 부르는 순간 아무도
 * end() 하지 않는 풀이 RSS 개수만큼 쌓여 Postgres 커넥션 한도를 찼고, 사이클은
 * `sorry, too many clients already`(53300)로 즉사했다. 테스트처럼 "한 번 만들고
 * afterAll에서 end()"하는 호출 패턴과 양립하려면 싱글턴을 돌려주되, 끊긴 뒤
 * 다시 부르면 새로 만들어 준다.
 */
export function ownerPool() {
  if (!ownerPoolInstance || ownerPoolInstance.ending || ownerPoolInstance.ended) {
    ownerPoolInstance = new Pool({
      host: HOST,
      port: POSTGRES_PORT,
      database: 'goodfriends',
      user: 'community_owner',
      password: PASSWORD,
      max: 4,
    });
  }
  return ownerPoolInstance;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toUuidArrayLiteral(ids: string[]): string {
  for (const id of ids) {
    // 바인드 파라미터로 넘기므로 SQL 주입은 불가능하지만, 형식이 깨지면
    // ::uuid[] 캐스트가 런타임에 터진다. 여기서 먼저 잡는 편이 진단이 쉽다.
    if (!UUID_RE.test(id)) throw new Error(`invalid uuid in relation set: ${id}`);
  }
  return `{${ids.join(',')}}`;
}

/**
 * 트랜잭션을 열고 관계 컨텍스트를 주입한 뒤 fn 을 실행한다.
 *
 * 재주입은 트랜잭션마다 일어난다 — 요청당 1회가 아니다.
 * 관계 집합 조회 자체는 요청당 1회만 하고 앱 메모리에 캐시해서 넘긴다(§9.2-bis).
 */
export async function withRelationCtx<T>(
  pool: pg.Pool,
  ctx: RelationCtx,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 벤치마크·잘못된 정책이 폭주할 때 커넥션 하나를 영원히 붙잡지 않도록.
    // SET LOCAL 이라 트랜잭션 스코프이며 §4.5 함정1과 같은 안전한 형태다.
    const settings = [
      "set_config('statement_timeout', '20s', true)",
      "set_config('app.user_id', $1, true)",
    ];
    const params: string[] = [ctx.userId ?? ''];
    if (ctx.friendIds) {
      params.push(toUuidArrayLiteral(ctx.friendIds));
      settings.push(`set_config('app.friend_ids', $${params.length}, true)`);
    }
    if (ctx.blockedIds) {
      params.push(toUuidArrayLiteral(ctx.blockedIds));
      settings.push(`set_config('app.blocked_ids', $${params.length}, true)`);
    }
    await client.query(`SELECT ${settings.join(', ')}`, params);

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 컨텍스트 주입 없이 쿼리 한 번. G1 가드가 "누수 여부"를 볼 때 쓴다. */
export async function queryRaw<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  sql: string,
  params: unknown[] = [],
) {
  const client = await pool.connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}
