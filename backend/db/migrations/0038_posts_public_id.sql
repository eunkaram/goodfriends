-- 0038 — posts.public_id: 짧은 불투명 URL ID (사용자 지시, 2026-08-21 —
-- "글 내용보기의 URL이 너무 길어서 줄이고 싶어")
--
-- 🔒 PRD §3.3 라우팅 규칙이 이미 "포스트 ID: 불투명 ID(ULID/nanoid), 순차 ID
-- 금지"를 못박아뒀다 — 지금까지는 그 결정을 안 지키고 Postgres 기본값인
-- gen_random_uuid()(36자)를 그대로 URL에 노출해왔다. 이 마이그레이션은 그
-- 결정을 실제로 지킨다: 내부 PK(id, uuid)는 그대로 두고(comments/reactions/
-- reports/moderation_access_log 등 모든 FK가 이걸 참조 — 무수정), URL
-- 전용으로 훨씬 짧은 public_id(11자)를 별도 컬럼으로 추가한다.
--
-- 기존 행 백필은 pgcrypto 확장 없이, 각 글이 이미 갖고 있는 id(UUID, 이미
-- 충분히 랜덤함)의 앞 8바이트를 base64url로 재인코딩해서 만든다 — 새
-- 엔트로피 소스가 필요 없다. 새 글은 애플리케이션이(src/posts.ts)
-- randomBytes(8).toString('base64url')로 직접 생성한다(이 코드베이스가
-- 세션·인증 토큰에 이미 쓰는 것과 같은 패턴, src/session.ts 등) — 생성
-- 방식은 다르지만 결과 포맷(11자 base64url, 64비트 엔트로피)은 동일하다.

BEGIN;

ALTER TABLE posts ADD COLUMN public_id text;

UPDATE posts
SET public_id = rtrim(
    translate(
        encode(substring(decode(replace(id::text, '-', ''), 'hex') from 1 for 8), 'base64'),
        '+/', '-_'
    ),
    '='
)
WHERE public_id IS NULL;

ALTER TABLE posts ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX posts_public_id_idx ON posts (public_id);

COMMIT;
