/**
 * 캐시 스탬피드 방지 (PRD §5.1.1 갱신 전략, T28)
 *
 * 82개 키(41개 카테고리 × 2창, §12.1 전면 공개 기준)가 한 초에 같이
 * 만료되면 그 순간 DB가 튄다. 키마다 ±30초 지터를 줘서 갱신 시각을
 * 흩뿌린다. 요청이 만료를 발견하고 계산하는 구조가 아니라, 백그라운드
 * 잡이 선제적으로 채워둔다.
 */
import type pg from 'pg';
import { cachePopularity, computePopularity, type PopularityWindow } from './popularity.ts';

const BASE_INTERVAL_MS = 5 * 60 * 1000;
const JITTER_MS = 30 * 1000;

function jitteredInterval(baseMs: number, jitterMs: number): number {
  return baseMs + (Math.random() * 2 - 1) * jitterMs;
}

/**
 * 활성 카테고리만 갱신한다(§5.1.1 "활성 키만") — 트래픽 없는 카테고리는
 * 스케줄에 올리지 않는다. categoryIds에 null을 포함하면 홈 전체("all")도
 * 갱신 대상이 된다.
 *
 * intervalMs/jitterMs는 테스트에서만 오버라이드한다 — 프로덕션 기본값은
 * 5분 ± 30초(§5.1.1).
 */
export function startPopularityRefreshJob(
  pool: pg.Pool,
  categoryIds: Array<string | null>,
  opts: { intervalMs?: number; jitterMs?: number } = {},
) {
  const intervalMs = opts.intervalMs ?? BASE_INTERVAL_MS;
  const jitterMs = opts.jitterMs ?? JITTER_MS;
  const timers: NodeJS.Timeout[] = [];

  async function refreshOne(categoryId: string | null, window: PopularityWindow) {
    const ids = await computePopularity(pool, categoryId, window);
    await cachePopularity(categoryId, window, ids);
  }

  for (const categoryId of categoryIds) {
    for (const window of ['7d', '24h'] as const) {
      // 시작 시각 자체도 지터를 줘서 잡 기동 순간에 전부 몰리지 않게 한다
      const initialDelay = Math.random() * jitterMs;
      const timer = setTimeout(function tick() {
        // 🔒 성능 점검 발견(2026-08-22) — 예전엔 refreshOne()을 fire-and-forget으로
        // 던지고 바로 다음 tick을 예약했다. DB가 느려져 refreshOne이 interval보다
        // 오래 걸리면 다음 tick이 아직 안 끝난 이전 계산과 겹쳐 돌았고, 그 겹침이
        // DB를 더 느리게 만들어 다음 tick도 또 겹치는 자기강화적 악순환이었다.
        // .finally()로 다음 tick 예약을 현재 실행이 끝난 뒤로 미뤄 겹침 자체를
        // 원천 차단한다.
        refreshOne(categoryId, window)
          .catch((err) => {
            console.error(`popularity refresh failed: ${categoryId ?? 'all'}/${window}`, err);
          })
          .finally(() => {
            const next = setTimeout(tick, jitteredInterval(intervalMs, jitterMs));
            timers.push(next);
          });
      }, initialDelay);
      timers.push(timer);
    }
  }

  return function stop() {
    for (const t of timers) clearTimeout(t);
  };
}
