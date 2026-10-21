/**
 * 뉴스봇 워커 CLI — plan §3("worker/ — RSS 8개 수집 … 발행")의 실행 파일.
 *
 *   node worker/news-bot.ts          # 1회 사이클(cron/launchd에 넣는 용도)
 *   node worker/news-bot.ts --loop   # 상주하며 NEWS_CYCLE_HOURS(기본 24)마다 돈다
 *
 * 🔒 위치 — plan의 루트 `worker/`가 아니라 `backend/worker/`에 둔다: DB 풀·
 * Redis·error-alert 등 backend/src 모듈을 그대로 재사용하려면 같은
 * package.json 아래가 단순하다. 루트 worker/는 의존성이 갈라지는 순간
 * 유지보수 비용이 커진다(1차 결정 — PLAN.md에 기록).
 *
 * 사이클 실패 정책: 이 CLI의 책임은 "사이클 안의 소스·LLM 실패가 사이클을
 * 죽이지 않는다"는 것(그건 news-bot.ts가 alertAdminOfError로 알린다).
 * 여기서 잡는 건 사이클 자체의 크래시(DB 죽음)다.
 */
import { runNewsCycle } from '../src/news-bot.ts';
import { ownerPool } from '../src/db.ts';

async function main(): Promise<void> {
  const loop = process.argv.includes('--loop');
  const intervalMs = Number(process.env.NEWS_CYCLE_HOURS ?? 24) * 3600 * 1000;

  const runOnce = async () => {
    const started = Date.now();
    try {
      const result = await runNewsCycle();
      console.log(
        `[news-bot] cycle in ${Date.now() - started}ms — fetched=${result.fetched} recorded=${result.recorded} discarded=${result.discarded} summarized=${result.summarized} published=${result.published} failures=${result.failures} publishFailures=${result.publishFailures}`,
      );
    } catch (err) {
      console.error('[news-bot] 사이클 크래시:', err);
      // 크래시 알림은 server.ts의 처리 안 된 예외 경로와 같은 대상 — 이 워커엔
      // 그 경로가 없으므로 직접 불러준다.
      const { alertAdminOfError } = await import('../src/error-alert.ts');
      await alertAdminOfError(err, 'news-bot-cycle-crash');
    }
  };

  await runOnce();
  if (loop) {
    console.log(`[news-bot] loop mode — ${intervalMs / 3600000}시간마다 다시 돈다 (Ctrl+C로 종료)`);
    setInterval(runOnce, intervalMs);
  } else {
    // 🔒 결함 교훈(53300, db.ts ownerPool 주석) — 단발 실행은 풀을 풀어줘야
    // node 프로세스가 열린 소켓 때문에 끝나지 않고 매달리지 않는다.
    await ownerPool().end();
  }
}

await main();
