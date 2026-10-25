-- 0055 — 댓글 본문 부분일치 인덱스(관리자 댓글 검색 등).
--
-- 0011은 comments_target_idx(target_type, target_id)만 만들었다 — 글 상세에서
-- 한 글의 댓글을 시간순으로 읽는 경로만 지원하고, "본문에 이 단어가 들어간
-- 댓글"을 전체에서 찾는 경로는 인덱스가 없어 Seq Scan이었다.
--
-- 0001의 posts_title_bigm_idx/posts_body_bigm_idx와 같은 계약을 따른다:
-- lower(body) LIKE '%검색어%' ESCAPE '\' 로 질의해야 이 인덱스를 탄다.
-- ILIKE는 쓰지 않는다.
--
-- 댓글은 post 대상만 검색하므로(target_type='post') 부분 인덱스로 충분하다 —
-- 대상 글의 공개 범위는 쿼리가 posts를 JOIN해 걸러낸다(comments에는 RLS가
-- 없어 단독 SELECT 금지, comments.ts 상단 주석 참고).

BEGIN;

CREATE INDEX IF NOT EXISTS comments_body_bigm_idx
    ON comments USING gin (lower(body) gin_bigm_ops)
    WHERE target_type = 'post';

COMMIT;
