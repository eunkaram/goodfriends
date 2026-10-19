-- 0050 — 1차 개발(M2) 스키마: 조회수, Q&A 채택, 개발 로그 시리즈
--
-- 1) posts.views — 조회수. RLS는 comments/reactions 방침 없음(0001 전례)으로
--    카운터 증가만 app DX 쓰기 경로에서 진행한다. 단순 정수 카운터 — 정확도
--    요구사항은 1차에 없다(중복은 Redis dedup, CCTV급 정밀도 불필요).
ALTER TABLE posts ADD COLUMN views integer NOT NULL DEFAULT 0;

-- 2) Q&A 채택 — "답변 채택 → FAQ 후보" (PLAN M2). Q&A 생성 카테고리는
--    'qna' 슬러그 하나(0049). posts.adopted_comment_id는 NULL=미채택이
--    기본이라 기존 글(비-Q&A 포함)에 영향 없다. FK → comments(id) —
--    댓글이 삭제되면 자동 해제(SET NULL).
ALTER TABLE posts ADD COLUMN adopted_comment_id uuid REFERENCES comments(id) ON DELETE SET NULL;

-- 3) 개발 로그 시리즈 — "연재로 묶기". 시리즈는 글 작성자 소유.
--    posts.series_id (ON DELETE SET NULL — 시리즈가 사라져도 글은 유지),
--    posts.series_index = 시리즈 내 표시 순번(선택). 카테고리 dev-log와
--    무관하게 어떤 글도 켜진다 — "Q&A 답변도 시리즈로 묶는다"는 스펙이
--    없으므로 제한은 앱 레이어에서: 시리즈 소유자 = 글 작성자.
CREATE TABLE series (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX series_owner_idx ON series (owner_id, created_at);

ALTER TABLE posts ADD COLUMN series_id uuid REFERENCES series(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN series_index integer;
CREATE INDEX posts_series_idx ON posts (series_id, series_index NULLS LAST, created_at);

ALTER TABLE series OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON series TO community_app_exists;
