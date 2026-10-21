/**
 * 시드 실행기 — 시드 퍼르소나 3계정 가입·인증 → dev-log 시리즈 5편 + 쇼케이스 2편
 * + 꿀팁 4편 + Q&A 4건 발행 + 채택 답변 1건. 백엔드 dev 서버가 떠 있어야 한다.
 *
 *   cd backend && nohup npm run dev > /tmp/backend-dev.log 2>&1 &
 *   node --experimental-strip-types scripts/seed-run.ts
 *
 * 스텝 로그에는 [email:stub]으로 인증 토큰이 찍히므로 스크립트가 자체 파싱한다.
 * 재실행 가능(idempotent): 이미 같은 제목 글이 있으면 그 글을 재사용 끝.
 */
import { readFile } from 'node:fs/promises';
import { PERSONAS, POSTS, SERIES, QNA_ANSWERS } from './seed-content.ts';

const BASE = process.env.SEED_BASE_URL ?? 'http://127.0.0.1:3010';
const DEV_LOG = process.env.SEED_DEV_LOG ?? '/tmp/backend-dev.log';

function fail(msg: string): never {
  console.error(`[seed-run] ✗ ${msg}`);
  process.exit(1);
}

async function api(method: string, path: string, cookie: string | null, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const setCookie = res.headers.get('set-cookie');
  return { res, json, setCookie };
}

async function main(): Promise<void> {
  // 1) 가입 + 이메일 인증 — 인증 토큰은 서버 콘솔([email:stub])에서 파싱.
  await readFile(DEV_LOG, 'utf8').catch(() => fail(`dev 로그가 없다: ${DEV_LOG}`));

  const cookies: Record<string, string> = {};
  for (const p of PERSONAS) {
    const signup = await api('POST', '/api/auth/signup', null, {
      nickname: p.nickname,
      email: p.email,
      password: p.password,
      birthdate: p.birthdate,
      country: 'KR',
    });
    if (signup.res.status === 429) fail(`signup RATE_LIMITED — ${p.email} (IP당 5/h. 살짝 뒤에 재실행)`);
    if (signup.res.status !== 201) {
      // 유휴(idempotent) 재실행 — 이미 가입된 이메일이면 로그인 루트로.
      const errName = JSON.stringify(signup.json);
      const login = await api('POST', '/api/auth/login', null, { email: p.email, password: p.password });
      if (login.res.status !== 200) fail(`signup ${p.email}: ${signup.res.status} ${errName} + login: ${login.res.status} ${JSON.stringify(login.json)}`);
      const loginRaw = login.setCookie ?? '';
      const lm = loginRaw.match(/aic_session=([^;]+)/);
      if (!lm) fail(`login 쿠키 파싱 실패: ${loginRaw.slice(0, 80)}`);
      cookies[p.key] = `aic_session=${lm[1]}`;
      console.log(`[seed-run] 기존 계정 로그인: ${p.nickname}`);
    } else {
      const sessionRaw = signup.setCookie ?? '';
      const m = sessionRaw.match(/aic_session=([^;]+)/);
      if (!m) fail(`signup 쿠키 파싱 실패: ${sessionRaw.slice(0, 80)}`);
      cookies[p.key] = `aic_session=${m[1]}`;
    }

    const session = await api('GET', '/api/auth/session', cookies[p.key]);
    const alreadyVerified = Boolean((session.json as { emailVerified?: boolean }).emailVerified);
    if (!alreadyVerified) {
      const token = extractVerifyToken(await readFile(DEV_LOG, 'utf8'), p.email);
      if (!token) fail(`verify 토큰 파싱 실패 — ${p.email}`);
      const verify = await api('POST', '/api/auth/verify-email', cookies[p.key], { token });
      if (verify.res.status !== 200) fail(`verify ${p.email}: ${verify.res.status} ${JSON.stringify(verify.json)}`);
    }
    console.log(`[seed-run] 인증 확인: ${p.nickname} (${p.email})${alreadyVerified ? ' — 기인증' : ''}`);
  }

  // 2) 카테고리 slug → id
  const cats = await api('GET', '/api/categories', null);
  const catIds: Record<string, string> = {};
  for (const row of (cats.json as { categories?: Array<{ id: string; slug: string }> }).categories ?? []) {
    catIds[row.slug] = row.id;
  }
  for (const slug of [...new Set(POSTS.map((p) => p.categorySlug))]) {
    if (!catIds[slug]) fail(`카테고리 없음: ${slug}`);
  }

  // 3) 발행 — idempotent: 같은 제목이 이미 있으면 건너뛴다
  const created: Record<string, { id: string; publicId: string }> = {};
  for (const post of POSTS) {
    const dup = await api('GET', `/api/posts/search?q=${encodeURIComponent(post.title)}&count=1`, null);
    const dupRows = (dup.json as { results?: Array<{ id: string; publicId: string }> }).results ?? [];
    const same = dupRows.find((r) => (r as { title?: string }).title === post.title);
    if (same) {
      created[post.key] = { id: same.id, publicId: same.publicId };
      console.log(`[seed-run] 이미 있음, 건너� gravid: ${post.title}`);
      continue;
    }
    const r = await api('POST', '/api/posts', cookies[post.author], {
      title: post.title,
      body: post.body,
      categoryId: catIds[post.categorySlug],
    });
    if (r.res.status !== 201) fail(`post ${post.key}: ${r.res.status} ${JSON.stringify(r.json)}`);
    created[post.key] = { id: String(r.json.id), publicId: String(r.json.publicId) };
    console.log(`[seed-run] 발행: ${post.title}`);
  }

  // 4) 시리즈 — 같은 제목 시리즈 재사용
  const existingSeries = await api('GET', '/api/series', cookies[SERIES.owner]);
  let seriesId = ((existingSeries.json as { series?: Array<{ id: string; title: string }> }).series ?? []).find((s) => s.title === SERIES.title)?.id;
  if (!seriesId) {
    const sr = await api('POST', '/api/series', cookies[SERIES.owner], { title: SERIES.title, description: SERIES.description });
    if (sr.res.status !== 201) fail(`series: ${sr.res.status} ${JSON.stringify(sr.json)}`);
    seriesId = String((sr.json as { series: { id: string } }).series.id);
    console.log(`[seed-run] 시리즈 생성: ${SERIES.title}`);
  } else {
    console.log('[seed-run] 시리즈 이미 있음');
  }
  for (const key of SERIES.postKeys) {
    const post = POSTS.find((p) => p.key === key);
    if (!post) continue;
    const attach = await api('POST', `/api/series/${seriesId}/posts`, cookies[SERIES.owner], { postId: created[key].id });
    if (attach.res.status === 200 || attach.res.status === 201) continue;
    fail(`attach ${key}: ${attach.res.status} ${JSON.stringify(attach.json)}`);
  }
  console.log('[seed-run] 시리즈 연결 5건 완료');

  // 5) Q&A 답변 → 채택
  for (const ans of QNA_ANSWERS) {
    const cr = await api('POST', '/api/comments', cookies[ans.author], { postId: created[ans.postKey].id, body: ans.body });
    if (cr.res.status !== 201) fail(`comment ${ans.postKey}: ${cr.res.status} ${JSON.stringify(cr.json)}`);
    const commentId = String((cr.json as { id: string }).id);
    console.log(`[seed-run] 댓글: ${ans.postKey}`);
    if (ans.adopt) {
      const ad = await api('PATCH', `/api/posts/${created[ans.postKey].id}/adoption`, cookies[POSTS.find((p) => p.key === ans.postKey)!.author], { commentId });
      if (ad.res.status !== 200) fail(`adopt ${ans.postKey}: ${ad.res.status} ${JSON.stringify(ad.json)}`);
      console.log(`[seed-run] 채택: ${ans.postKey}`);
    }
  }

  // 6) 검증 — 각 카테고리 피드가 빈 페이지가 아님 (GET /api/feed?category=slug)
  for (const slug of [...new Set(POSTS.map((p) => p.categorySlug))]) {
    const feed = await api('GET', `/api/feed?category=${encodeURIComponent(slug)}&limit=1`, null);
    const rows = (feed.json as { posts?: unknown[] }).posts ?? [];
    if (!Array.isArray(rows) || rows.length === 0) fail(`카테고리 ${slug} 피드가 비었다`);
    console.log(`[seed-run] 카테고리 ${slug}: ${rows.length}건`);
  }
  console.log('[seed-run] 완료 ✅');
}

function extractVerifyToken(log: string, to: string): string | null {
  const lines = log.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // 스텁 메일 형식: 헤더(to=수신자) 뒤 본문 몇 줄에서 링크 파싱
    if (!lines[i].includes(`to=${to}`)) continue;
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const hit = lines[j].match(/verify-email\?token=([A-Za-z0-9_-]+)/)?.[1];
      if (hit) return hit;
      if (lines[j].startsWith('[email:stub')) break;
    }
  }
  return null;
}

await main();
