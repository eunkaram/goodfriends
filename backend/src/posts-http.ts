/**
 * 글쓰기 · 피드 페이징 HTTP 라우트 — §6.2, §5.1.
 *
 * intent-http/auth-http와 같은 패턴: 처리했으면 true, 아니면 false.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, json, isUuid, parsePageParam } from './http-utils.ts';
import { resolveSessionToken, getSessionUserId } from './session.ts';
import { createCommunityPost, createLogPost, deletePost, updatePost, resolvePostId, type CreatePostInput, type UpdatePostInput } from './posts.ts';
import { fetchHomeFeed, fetchCategoryFeed, type FeedSort } from './feed.ts';
import { fetchCategoryBySlug } from './categories.ts';
import { createComment, deleteComment, toggleCommentReaction, fetchComments } from './comments.ts';
import { fetchUserLogByUsername, fetchLogPosts } from './user-log.ts';
import { isEmailVerified } from './auth.ts';
import { fetchPostDetail } from './post-detail.ts';
import { searchPosts } from './feed.ts';
import { setAdoptedComment, isQnaPost } from './qna.ts';
import { redis } from './redis.ts';
import { ownerPool } from './db.ts';
import { clientIp } from './rate-limit.ts';

/** 조회수 dedup 키 — 같은 "브라우저 컨텍스트"가 하루에 한 번만 증가시킨다(M2 1차 단순 정책). */
async function bumpPostViewOnce(publicId: string, dedupKey: string): Promise<boolean> {
  try {
    const r = await redis().set(`post:view:${publicId}:${dedupKey}`, '1', 'EX', 60 * 60 * 24, 'NX');
    return r === 'OK';
  } catch {
    return true; // Redis 장애 시 카운터만 신뢰성 잃지 않게 — 너무 자주 증가해도 기능은 유지
  }
}

export async function handlePostsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'POST' && url.pathname === '/api/posts') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    // 🔒 사용자 지시(2026-08-24, "이메일 미인증 유저 글쓰기 제한") — 클릭은
    // 허용하고 서버가 막는다(결정: "클릭은 허용, 시도 시 안내"). posts.ts는
    // appPool이라 auth_credentials를 못 읽어(§6.1 자격증명 격리) 이 체크는
    // 반드시 여기(HTTP 레이어)에서 한다.
    if (!(await isEmailVerified(userId))) {
      json(res, 403, { error: 'EMAIL_NOT_VERIFIED' });
      return true;
    }
    const input = JSON.parse(await readBody(req)) as CreatePostInput;
    // 🔒 사용자 지시(2026-08, "Post Option... 게시판에 글을 쓸건지 내
    // 로그(프로파일)에만 글을 쓸건지") — categoryId 유무로 목적지를 가른다
    // (posts.ts CreatePostInput 주석 참고). categoryId가 왔으면 게시판
    // 글(기존 경로, 형식 검증 그대로 — 불변식 19), 없으면 로그 전용 글이라
    // visibility가 이 composer가 노출하는 두 값 중 하나인지만 확인한다.
    if (input.categoryId !== undefined) {
      // 🔒 /review 발견(api-contract) — categoryId 형식이 깨지면 아래 서비스
      // 함수 안의 uuid 컬럼 비교가 잡히지 않은 500으로 새어나갔다.
      if (!isUuid(input.categoryId)) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      const result = await createCommunityPost(userId, { categoryId: input.categoryId, title: input.title, body: input.body });
      if (!result.ok) {
        json(res, result.error === 'FORBIDDEN' ? 403 : 400, { error: result.error });
        return true;
      }
      json(res, 201, { id: result.id, publicId: result.publicId });
      return true;
    }
    if (input.visibility !== 'public' && input.visibility !== 'followers') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const logResult = await createLogPost(userId, { title: input.title, body: input.body, visibility: input.visibility });
    if (!logResult.ok) {
      json(res, 400, { error: logResult.error });
      return true;
    }
    json(res, 201, { id: logResult.id, publicId: logResult.publicId });
    return true;
  }

  // 🔒 모바일 API 레퍼런스 작성 중 발견한 공백(2026-08-29) — 글 상세(본문
  // 전체+댓글)를 반환하는 JSON 엔드포인트가 지금까지 없었다. 웹은 이걸
  // app/[category]/[publicId]/page.tsx가 fetchPostDetail·fetchComments를
  // SSR 중 직접 import해서 메운다 — 모바일은 SSR이 없으니 이 엔드포인트가
  // 반드시 필요하다. DELETE/PATCH와 달리 publicId만 받는다(uuid 폴백 없음)
  // — fetchPostDetail 자체가 publicId 전용이고, 내부 uuid는 PostDetail.id
  // 문서 주석대로 "URL에는 절대 안 나간다"라 애초에 외부에서 uuid로 조회할
  // 일이 없다.
  // 🔒 M2 — 공개 검색. 동적 `/api/posts/:id` 매치에 흡수되지 않게 그 위에둔다.
  if (req.method === 'GET' && url.pathname === '/api/posts/search') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    const q = (url.searchParams.get('q') ?? '').trim();
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });
    const categorySlug = url.searchParams.get('category') ?? undefined;
    const posts = await searchPosts(userId, q, { limit, offset, categorySlug });
    json(res, 200, { posts });
    return true;
  }

  const getMatch = req.method === 'GET' && url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (getMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    const publicId = getMatch[1];
    const post = await fetchPostDetail(userId, publicId);
    // RLS가 삭제·차단·공개범위를 이미 걸러준다 — 0행이면 그대로 404
    // (§10.2와 같은 원칙, "차단당함"과 "존재 안 함"을 구분해 알려주지 않는다).
    if (!post) {
      json(res, 404, { error: 'NOT_FOUND' });
      return true;
    }
    const comments = await fetchComments(userId, post.id);
    // 🔒 M2 — 조회수. 작성자 본인 조회는 세지 않는다, 같은 세션(로그인)
    // 또는 같은 IP(비로그인)는 24시간에 1번만(Redis NX dedup — 실패해도 카운터 자체는 살아있다).
    // posts UPDATE는 RLS가 author=본인으로 제한하므로 남의 글 views 컬럼 증가는
    // owner 컨텍스트로 찍는다(개인 데이터 정책과 무관한 통계 컬럼).
    // 응답의 views는 방금 증가분까지 반영해 보여준다.
    let viewedThisTime = false;
    if (userId !== post.authorId) {
      const dedupKey = userId ? `s:${sessionToken}` : `ip:${clientIp(req)}`;
      if (await bumpPostViewOnce(post.publicId, dedupKey)) {
        await ownerPool().query(`UPDATE posts SET views = views + 1 WHERE id = $1`, [post.id]);
        viewedThisTime = true;
      }
    }
    if (viewedThisTime) post.views += 1;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' });
    res.end(JSON.stringify({ post, comments }));
    return true;
  }

  // 사용자 발견(2026-08) — "내 글삭제는 어떻게해? 기능이 빠져있는것 같아".
  // 다른 라우트는 전부 고정 경로라 postId가 body/query로 왔지만, 이건
  // REST 관례상 경로에 둔다 — DELETE/PATCH 둘 다 이 패턴을 쓴다.
  const deleteMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (deleteMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    let postId = deleteMatch[1];
    // 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을
    // 처리하는데 계속 에러가 뜬다") — 글 URL이 public_id(0038)로 바뀐 뒤로
    // 외부 호출자가 아는 유일한 글 식별자가 이것뿐이다. src/http-server.ts의
    // /api/intent/execute와 같은 패턴으로 uuid가 아니면 먼저 public_id로
    // 해석해본다 — 해석 실패는 그대로 400.
    if (!isUuid(postId)) {
      const resolvedId = await resolvePostId(postId);
      if (!resolvedId) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      postId = resolvedId;
    }
    const result = await deletePost(userId, postId);
    if (!result.ok) {
      json(res, 404, { error: result.error }); // §10.2 — 본인 글이 아닌지 존재 안 하는지 구분해서 알려주지 않는다
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 사용자 발견(2026-08) — "내글에 대해 수정기능이 없어. 수정할수 있게 만들어줘".
  // DELETE와 같은 경로 파라미터 패턴 — PATCH /api/posts/:id.
  const updateMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (updateMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    let postId = updateMatch[1];
    // 🔒 위 DELETE /api/posts/:id와 같은 이유(public_id 해석) — 2026-08-22.
    if (!isUuid(postId)) {
      const resolvedId = await resolvePostId(postId);
      if (!resolvedId) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      postId = resolvedId;
    }
    const input = JSON.parse(await readBody(req)) as UpdatePostInput;
    // 🔒 사용자 지시(2026-08, "글 수정도 똑같이 기능이 구현되어야해") — POST와
    // 같은 categoryId 유무 분기(불변식 19 — client-supplied categoryId는
    // 서비스 함수 안까지 그대로 흘려보내지 않는다).
    if (input.categoryId !== undefined) {
      if (!isUuid(input.categoryId)) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
    } else if (input.visibility !== 'public' && input.visibility !== 'followers') {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await updatePost(userId, postId, input);
    if (!result.ok) {
      // §10.2 — 본인 글이 아닌지 존재 안 하는지 구분해서 알려주지 않는다. FORBIDDEN(News 등
      // 어드민·시스템 전용 카테고리로의 이동)만 그 원칙 밖 — 카테고리 자체는 공개 정보다.
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 🔒 M2 — Q&A 채택. PATCH /api/posts/:public_id/adoption
  // { commentId: string | null } — null은 채택 해제. qna.ts가 권한·대상을 검증.
  const adoptMatch = req.method === 'PATCH' && url.pathname.match(/^\/api\/posts\/([^/]+)\/adoption$/);
  if (adoptMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    let postId = adoptMatch[1];
    // DELETE/PATCH /api/posts/:id와 같은 public_id 해석.
    if (!isUuid(postId)) {
      const resolvedId = await resolvePostId(postId);
      if (!resolvedId) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      postId = resolvedId;
    }
    const input = JSON.parse(await readBody(req)) as { commentId: unknown };
    if (input.commentId !== null && !isUuid(input.commentId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await setAdoptedComment(userId, postId, input.commentId as string | null);
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 200, { ok: true, commentId: result.commentId });
    return true;
  }

  // §4.3 — 홈/카테고리 피드는 비로그인도 커뮤니티 글을 읽는다. 세션은 있으면 쓰고 없어도 막지 않는다.
  if (req.method === 'GET' && url.pathname === '/api/feed') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    const sort = (url.searchParams.get('sort') === 'popular' ? 'popular' : 'latest') as FeedSort;
    const limit = parsePageParam(url.searchParams.get('limit'), 20, { min: 1, max: 50 });
    const offset = parsePageParam(url.searchParams.get('offset'), 0, { min: 0, max: Number.MAX_SAFE_INTEGER });

    const categorySlug = url.searchParams.get('category');
    if (categorySlug) {
      const category = await fetchCategoryBySlug(categorySlug);
      if (!category) {
        json(res, 404, { error: 'NOT_FOUND' });
        return true;
      }
      const posts = await fetchCategoryFeed(userId, category.id, { sort, limit, offset });
      json(res, 200, { posts });
      return true;
    }

    // 사용자 지시(2026-08) — "좌측 Posts메뉴는 게시판, 공개된 개인 post로
    // 구분없이 최신순으로 리스트". `/@{username}/posts`의 더보기 페이지네이션
    // 전용 — user_logs RLS(app_can_view_tier)와 같은 로그인 게이트라 비로그인은
    // 401로 막는다(§4.3, page.tsx가 애초에 이 상태에선 이 화면 자체를 안 그린다).
    const username = url.searchParams.get('username');
    if (username) {
      if (!userId) {
        json(res, 401, { error: 'NOT_AUTHENTICATED' });
        return true;
      }
      const log = await fetchUserLogByUsername(userId, username);
      if (!log) {
        json(res, 404, { error: 'NOT_FOUND' });
        return true;
      }
      const posts = await fetchLogPosts(userId, log.userId, limit, offset);
      json(res, 200, { posts });
      return true;
    }

    const posts = await fetchHomeFeed(userId, { sort, limit, offset });
    json(res, 200, { posts });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/comments') {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await isEmailVerified(userId))) {
      json(res, 403, { error: 'EMAIL_NOT_VERIFIED' });
      return true;
    }
    const parsed = JSON.parse(await readBody(req)) as {
      postId: string;
      body: string;
      parentCommentId?: string | null;
    };
    const { body, parentCommentId } = parsed;
    let { postId } = parsed;
    // 🔒 사용자 발견(2026-08-22, "AI 에이전트가 api를 호출해서 공감을
    // 처리하는데 계속 에러가 뜬다") — 위 DELETE /api/posts/:id와 같은 이유
    // (public_id 해석).
    if (!isUuid(postId)) {
      const resolvedId = await resolvePostId(postId);
      if (!resolvedId) {
        json(res, 400, { error: 'INVALID_INPUT' });
        return true;
      }
      postId = resolvedId;
    }
    // 사용자 지시(2026-08, 1-depth 답글) — 불변식 19: client-supplied id는 라우트 경계에서 먼저 걸러낸다.
    if (parentCommentId != null && !isUuid(parentCommentId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await createComment(userId, postId, body, parentCommentId ?? null);
    if (!result.ok) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'RATE_LIMITED' ? 429 : 400;
      json(res, status, { error: result.error });
      return true;
    }
    json(res, 201, { id: result.id });
    return true;
  }

  // 사용자 지시(2026-08, /design-review) — "점 세개부분에는 메뉴형태로
  // 수정하기, 삭제하기등이 있으면 좋을것 같아". posts의 DELETE/PATCH와
  // 같은 경로 파라미터 패턴.
  const deleteCommentMatch = req.method === 'DELETE' && url.pathname.match(/^\/api\/comments\/([^/]+)$/);
  if (deleteCommentMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    const commentId = deleteCommentMatch[1];
    if (!isUuid(commentId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await deleteComment(userId, commentId);
    if (!result.ok) {
      json(res, 404, { error: result.error }); // §10.2 — 본인 댓글이 아닌지 존재 안 하는지 구분해서 알려주지 않는다
      return true;
    }
    json(res, 200, { ok: true });
    return true;
  }

  // 사용자 지시(2026-08, /design-review) — "하트와 댓글만 사용해". 댓글의
  // 좋아요 토글 — 반응 6종 중 '공감'만 쓴다(포스트 상세 compact 바와 같은 결정).
  const reactionMatch = req.method === 'POST' && url.pathname.match(/^\/api\/comments\/([^/]+)\/reaction$/);
  if (reactionMatch) {
    const sessionToken = resolveSessionToken(req);
    const userId = await getSessionUserId(sessionToken);
    if (!userId) {
      json(res, 401, { error: 'NOT_AUTHENTICATED' });
      return true;
    }
    if (!(await isEmailVerified(userId))) {
      json(res, 403, { error: 'EMAIL_NOT_VERIFIED' });
      return true;
    }
    const commentId = reactionMatch[1];
    if (!isUuid(commentId)) {
      json(res, 400, { error: 'INVALID_INPUT' });
      return true;
    }
    const result = await toggleCommentReaction(userId, commentId);
    if (!result.ok) {
      json(res, 404, { error: result.error });
      return true;
    }
    json(res, 200, { reacted: result.reacted });
    return true;
  }

  return false;
}
