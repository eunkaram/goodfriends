/**
 * 신고하기 — Claude Design 확정안(2026-08, claude.ai/code/artifact/f5b62935-...)의
 * 글/댓글 "..." 메뉴 "Report".
 *
 * 🔒 실전 발견 — `reports` 테이블은 이미 0007_moderation_foundation.sql에 있었다
 * (§4.6 메시지 모더레이션 기반으로 먼저 만들어짐, `app_is_moderator()`/
 * `app_moderator_can_view()` 헬퍼까지 포함). 검색 없이 새 마이그레이션부터
 * 짰다가 `relation "reports" already exists`로 걸렸다 — 기존 스키마를 그대로
 * 재사용한다. 이 테이블은 RLS 대상이 아니다(0007 주석: "접근 제어는 이
 * 테이블을 참조하는 쪽이 담당") — reason은 NOT NULL이라 클라이언트가 안 주면
 * 기본값을 채운다. status/handled_by는 모더레이터 큐(§16 Tier 8, 범위 밖)
 * 몫이라 이번 라운드는 접수만 한다.
 */
import { appPool, withRelationCtx } from './db.ts';
import { checkRateLimit } from './rate-limit.ts';

export type ReportTargetType = 'post' | 'comment';

const pool = appPool('exists');

const MAX_REASON_LENGTH = 500;
const DEFAULT_REASON = '사유 미입력';

export type CreateReportResult = { ok: true } | { ok: false; error: 'INVALID_INPUT' | 'NOT_FOUND' | 'RATE_LIMITED' };

/**
 * 🔒 P4와 같은 원칙 — 신고 대상이 지금도 RLS로 보이는지 재검증한다. comments는
 * RLS가 없어(§13 다형성) posts 조인으로 대신 확인한다(comments.ts와 같은 패턴).
 */
export async function createReport(userId: string, targetType: ReportTargetType, targetId: string, reason?: string): Promise<CreateReportResult> {
  if (targetType !== 'post' && targetType !== 'comment') return { ok: false, error: 'INVALID_INPUT' };
  const trimmedReason = reason?.trim();
  if (trimmedReason && trimmedReason.length > MAX_REASON_LENGTH) return { ok: false, error: 'INVALID_INPUT' };

  if (!(await checkRateLimit(`report:${userId}`, 10, 3600))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  return withRelationCtx(pool, { userId }, async (client) => {
    const visible =
      targetType === 'post'
        ? await client.query('SELECT 1 FROM posts WHERE id = $1', [targetId])
        : await client.query(`SELECT 1 FROM comments c JOIN posts p ON p.id = c.target_id AND c.target_type = 'post' WHERE c.id = $1`, [targetId]);
    if ((visible.rowCount ?? 0) === 0) return { ok: false, error: 'NOT_FOUND' };

    await client.query(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1, $2, $3, $4)`, [
      userId,
      targetType,
      targetId,
      trimmedReason || DEFAULT_REASON,
    ]);
    return { ok: true };
  });
}

export type ReportListRow = {
  id: string;
  reporterUsername: string | null;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: 'open' | 'resolved';
  createdAt: string;
  targetTitle: string | null;
  targetExcerpt: string | null;
  targetAuthorUsername: string | null;
  targetDeleted: boolean;
  /** 원문 링크용 — 글 신고면 자기 자신, 댓글 신고면 그 댓글이 달린 부모 글. 내부 PK — 삭제/처리 API 호출에만 쓴다. */
  targetPostId: string | null;
  /** 공개 URL에 쓰는 짧은 불투명 ID(0038). AdminPostSearch.tsx/AdminCommentSearch.tsx와 같은 href 규칙(categorySlug ? '/{slug}/{publicId}' : '/post/{publicId}'). */
  targetPostPublicId: string | null;
  targetCategorySlug: string | null;
};

const TARGET_EXCERPT_LENGTH = 200;

/**
 * 신고 목록 + 대상 글/댓글 미리보기(사용자 발견, 2026-08-18 — "글/댓글 관리는
 * 어디서 해?": target_type/target_id만 보여줘선 뭘 신고당했는지 알 수 없었다).
 * resolve(상태 변경)는 이제 resolveReport()(moderation.ts)로 있다.
 *
 * 🔒 posts는 RLS 대상이라(0002) moderatorId로 app.user_id를 SET LOCAL 해야
 * 한다 — 0035가 posts SELECT 정책에 추가한 `app_moderator_can_view()`가
 * 이걸로 "열린 신고 건에 연결된 대상"만 예외적으로 보여준다(§4.6). comments는
 * RLS가 없지만(§13) posts.ts/comments.ts의 확립된 규칙대로 여기서도 posts를
 * 거쳐 조인한다 — comments 단독 조회 금지 규칙은 예외 없이 지킨다.
 */
export async function listReports(moderatorId: string, limit: number, offset: number): Promise<ReportListRow[]> {
  const rows = await withRelationCtx(pool, { userId: moderatorId }, (client) =>
    client.query<{
      id: string;
      reporter_username: string | null;
      target_type: ReportTargetType;
      target_id: string;
      reason: string;
      status: 'open' | 'resolved';
      created_at: string;
      target_title: string | null;
      target_excerpt: string | null;
      target_author_username: string | null;
      target_deleted: boolean;
      target_post_id: string | null;
      target_post_public_id: string | null;
      target_category_slug: string | null;
    }>(
      `SELECT r.id, u.username AS reporter_username, r.target_type, r.target_id, r.reason, r.status, r.created_at,
              p.title AS target_title,
              CASE
                WHEN r.target_type = 'post' THEN LEFT(p.body, $3)
                WHEN r.target_type = 'comment' THEN LEFT(c.body, $3)
              END AS target_excerpt,
              COALESCE(pa.username, ca.username) AS target_author_username,
              CASE
                WHEN r.target_type = 'post' THEN (p.id IS NULL OR p.deleted_at IS NOT NULL)
                WHEN r.target_type = 'comment' THEN c.id IS NULL
                ELSE true
              END AS target_deleted,
              COALESCE(p.id, cp.id) AS target_post_id,
              COALESCE(p.public_id, cp.public_id) AS target_post_public_id,
              COALESCE(catp.slug, catcp.slug) AS target_category_slug
       FROM reports r
       LEFT JOIN users u ON u.id = r.reporter_id
       LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
       LEFT JOIN users pa ON pa.id = p.author_id
       LEFT JOIN categories catp ON catp.id = p.category_id
       LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
       LEFT JOIN users ca ON ca.id = c.author_id
       LEFT JOIN posts cp ON r.target_type = 'comment' AND c.target_type = 'post' AND cp.id = c.target_id
       LEFT JOIN categories catcp ON catcp.id = cp.category_id
       ORDER BY r.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, TARGET_EXCERPT_LENGTH],
    ),
  );
  return rows.rows.map((row) => ({
    id: row.id,
    reporterUsername: row.reporter_username,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    targetTitle: row.target_title,
    targetExcerpt: row.target_excerpt,
    targetAuthorUsername: row.target_author_username,
    targetDeleted: row.target_deleted,
    targetPostId: row.target_post_id,
    targetPostPublicId: row.target_post_public_id,
    targetCategorySlug: row.target_category_slug,
  }));
}
