-- 0047 — posts.updated_at (이슈 #11, "sitemap lastModified 정확도")
--
-- app/sitemap.ts(web)가 지금 lastModified를 created_at으로만
-- 채우고 있어서, 글을 수정해도 크롤러 재수집 우선순위 신호가 안 바뀐다.
-- posts엔 updated_at 컬럼 자체가 없었다 — 추가하고 콘텐츠를 바꾸는 UPDATE
-- 경로(updatePost, changePostCategoryAsModerator)가 채우게 한다.
--
-- 소프트삭제(deletePostAsModerator)는 콘텐츠가 안 바뀌니 건드릴 필요 없다.

BEGIN;

ALTER TABLE posts ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

COMMIT;
