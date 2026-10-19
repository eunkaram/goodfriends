-- 0011 — Comments (§13). T21 인기순 공식(반응수 + 댓글수×2)에 필요해 최소로 추가한다.
--
-- 🔒 RLS 미적용 — reactions와 같은 상태다. target_type/target_id 다형성이라
-- FK도 정책도 걸 수 없다(§13 "다형성 참조의 정합성 규칙"). 지금은 댓글 조회
-- API가 없어 위험이 없지만, 실제로 만들 때는 반드시 대상(post 등)을 조인해
-- 그 RLS를 태우는 경로로만 노출해야 한다 — comments 단독 SELECT는 이 GRANT
-- 만으로 전부 노출된다. 댓글 기능 본격 구현 시 이 갭을 닫을 것 (§16.5 후보).

BEGIN;

CREATE TABLE comments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL,
    target_id   uuid NOT NULL,
    author_id   uuid NOT NULL REFERENCES users(id),
    body        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_target_idx ON comments (target_type, target_id);

ALTER TABLE comments OWNER TO community_schema;
GRANT SELECT, INSERT, UPDATE, DELETE ON comments TO community_app_exists;

COMMIT;
