-- 0018 — /review에서 발견한 실전 결함 수정.
--
-- 1) posts.category_id에 categories로의 FK가 없었다 — 0015가 categories 테이블을
--    만들면서 "FK도 없는 빈 uuid" 문제를 해결한다고 적어놓고 정작 FK를 안 걸었다.
--    앱 레이어(src/posts.ts createCommunityPost)도 존재 여부·타입(community/market)을
--    검증하지 않아, 로그인 사용자가 마켓 카테고리나 미공개(is_public=false) 카테고리
--    UUID를 커뮤니티 글에 꽂아 넣을 수 있었다(카테고리 데이터 자체가 훼손되진
--    않지만, §5 "마켓은 홈 피드 제외" 원칙을 우회하는 경로가 생긴다).
-- 2) market_posts.author_id에 인덱스가 없어 "내 판매 글" 위젯 쿼리가 시퀀셜 스캔.
-- 3) password_reset_tokens.user_id에 인덱스가 없어 재설정 시 "내 다른 미사용
--    토큰 정리" 쿼리가 PK(token_hash)를 못 쓴다.
-- 4) market_posts.category_id에도 인덱스가 없어 카테고리로 좁힌 최신순 조회가
--    시퀀셜 스캔(EXPLAIN ANALYZE 실측: 20만 행에서 0건 매치에도 3,627버퍼).

BEGIN;

ALTER TABLE posts ADD CONSTRAINT posts_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id);

CREATE INDEX market_posts_author_idx ON market_posts (author_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX market_posts_category_created_idx ON market_posts (category_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id) WHERE consumed_at IS NULL;

COMMIT;
