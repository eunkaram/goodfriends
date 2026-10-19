-- 0032 — 프로필 통계에 "댓글" 추가 + postCount 버그 수정
--
-- 사용자 지시(2026-08, "프로필 페이지의 글, 좋아요, follower수 있는 부분에
-- 댓글도 추가 해주고, 모든 데이터가 제대로 잘 나오는지 확인해줘. 잘
-- 안나오는것 같아") — 실측 결과 postCount 자체가 버그였다: src/user-log.ts의
-- fetchUserLogByUsername이 `WHERE p.log_id = ul.user_id`로 세고 있었는데,
-- 이건 "My Post"(로그 전용) 글만 세고 커뮤니티 게시판 글(category_id 있는
-- 글, log_id는 항상 NULL)은 전부 빠뜨린다 — 실측(reafy 계정: 전체 13개 글
-- 중 1개만 잡힘). app_post_like_count(0025)와 같은 author_id 기준으로
-- 바꾼다. "댓글"은 그 like_count와 정확히 같은 패턴(§4.3 뷰어 시점 철학,
-- 0025 주석 참고)으로 "내 글들이 받은 댓글 총합"을 센다 — comments는
-- RLS가 없는 다형성 테이블(§13)이라 posts JOIN만으로 뷰어가 볼 수 있는
-- 글의 댓글만 자연히 걸러진다(SECURITY DEFINER 불필요).

BEGIN;

CREATE FUNCTION app_post_comment_count(owner_id uuid) RETURNS bigint
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT count(*) FROM comments c
    JOIN posts p ON p.id = c.target_id
    WHERE c.target_type = 'post' AND p.author_id = owner_id
$$;

COMMIT;
