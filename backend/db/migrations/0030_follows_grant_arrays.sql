BEGIN;

-- 🔒 실전 버그(0029 적용 후 G1 게이트 테스트에서 발견) — posts_select_arrays
-- 정책이 새로 app_is_followed_by()를 호출하면서 follows 테이블을 SELECT하게
-- 됐는데, follows는 0014에서 community_app_exists에만 GRANT됐다(당시엔 어떤
-- _arrays 정책도 follows를 안 건드렸다). community_app_arrays로 접속해 posts를
-- 조회하면 RLS 정책 평가 중 "permission denied for table follows"로 죽는다.
GRANT SELECT ON follows TO community_app_arrays;

COMMIT;
