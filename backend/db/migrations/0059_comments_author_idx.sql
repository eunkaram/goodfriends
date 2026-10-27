-- 0059 — 프로필 "댓글" 탭(내가 댓글을 쓴 글 목록) 인덱스.
--
-- 0011의 comments_target_idx는 글 → 댓글 방향만 지원한다. feed.ts의
-- fetchPostsCommentedByUser는 반대로 author_id로 시작해 글별 최근 댓글
-- 시각을 뽑으므로(target_type='post') 인덱스가 없으면 댓글 전체를 훑는다.
-- 댓글 작성자 기준 조회는 post 대상만 쓰므로 부분 인덱스로 충분하다.

BEGIN;

CREATE INDEX IF NOT EXISTS comments_author_post_idx
    ON comments (author_id, target_id, created_at DESC)
    WHERE target_type = 'post';

COMMIT;
