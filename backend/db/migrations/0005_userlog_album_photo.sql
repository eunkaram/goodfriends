-- 0005 — UserLog · Album · Photo (§13, §4.1 중첩 규칙, §4.3 로그인 필수)
--
-- 이 셋은 전부 §4.3 "로그 홈 · 앨범 · 프로필 · 친구 목록 ❌ (비로그인)" 대상이다.
-- `전체공개`여도 비로그인은 못 본다 — posts의 커뮤니티 글과 다른 지점.
--
-- 앞으로 새 테이블은 community_app_exists 하나만 쓴다. community_app_arrays는
-- T11 벤치마크 전용으로 posts에만 남아 있다 (§9.2-bis에서 EXISTS로 확정됨).

BEGIN;

-- 로그인 + 차단 + (본인 OR 공개범위 통과) 를 한 번에 판정하는 공용 헬퍼.
-- UserLog·Album·Photo처럼 "소유자 1명 + 공개범위 3단계" 형태의 테이블에서
-- 반복되는 조건을 한 곳에 모은다 — posts에서 겪은 비대칭 실수 재발 방지.
CREATE OR REPLACE FUNCTION app_can_view_tier(owner_id uuid, tier text) RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
    SELECT
        app_current_user_id() IS NOT NULL
        AND NOT app_is_blocked_with(owner_id)
        AND (
            owner_id = app_current_user_id()
            OR tier = 'public'
            OR (tier = 'friends' AND app_is_friends_with(owner_id))
        )
$$;

-- ─────────────────────────────────────────────────────────────
CREATE TABLE user_logs (
    user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    title       text NOT NULL DEFAULT '',
    cover_media_id uuid,  -- Media 테이블 미구현 (§13) — FK는 그때 추가
    intro       text NOT NULL DEFAULT '',
    visibility  text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE albums (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    log_id        uuid NOT NULL REFERENCES user_logs(user_id) ON DELETE CASCADE,
    title         text NOT NULL,
    cover_photo_id uuid,  -- photos(id) 순환 참조라 FK 미설정, 앱 레이어 검증
    visibility    text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
    sort          integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE photos (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    album_id     uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id     uuid,  -- Media 테이블 미구현 (§13)
    description  text NOT NULL DEFAULT '',
    visibility   text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
    sort         integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

CREATE INDEX albums_log_idx ON albums (log_id, sort);
CREATE INDEX photos_album_idx ON photos (album_id, sort) WHERE deleted_at IS NULL;

ALTER TABLE user_logs OWNER TO community_schema;
ALTER TABLE albums    OWNER TO community_schema;
ALTER TABLE photos    OWNER TO community_schema;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_logs, albums, photos TO community_app_exists;

ALTER TABLE user_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE albums    ENABLE ROW LEVEL SECURITY;
ALTER TABLE albums    FORCE ROW LEVEL SECURITY;
ALTER TABLE photos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos    FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- UserLog
-- ─────────────────────────────────────────────────────────────
CREATE POLICY user_logs_select ON user_logs
    FOR SELECT TO community_app_exists
    USING (app_can_view_tier(user_id, visibility));

CREATE POLICY user_logs_insert ON user_logs FOR INSERT TO community_app_exists
    WITH CHECK (user_id = app_current_user_id());
CREATE POLICY user_logs_update ON user_logs FOR UPDATE TO community_app_exists
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
CREATE POLICY user_logs_delete ON user_logs FOR DELETE TO community_app_exists
    USING (user_id = app_current_user_id());

-- ─────────────────────────────────────────────────────────────
-- Album — 소유자는 log_id (= user_logs.user_id)
-- ─────────────────────────────────────────────────────────────
CREATE POLICY albums_select ON albums
    FOR SELECT TO community_app_exists
    USING (app_can_view_tier(log_id, visibility));

CREATE POLICY albums_insert ON albums FOR INSERT TO community_app_exists
    WITH CHECK (log_id = app_current_user_id());
CREATE POLICY albums_update ON albums FOR UPDATE TO community_app_exists
    USING (log_id = app_current_user_id()) WITH CHECK (log_id = app_current_user_id());
CREATE POLICY albums_delete ON albums FOR DELETE TO community_app_exists
    USING (log_id = app_current_user_id());

-- ─────────────────────────────────────────────────────────────
-- Photo — §4.1 중첩 규칙: 앨범 공개범위가 사진 공개범위보다 항상 우선한다.
-- photo.visibility 와 album.visibility 를 각각 app_can_view_tier로 판정해
-- 둘 다 통과해야 보인다. 소유자 본인은 owner_id=viewer 분기로 두 호출 다
-- 즉시 통과한다.
-- ─────────────────────────────────────────────────────────────
CREATE POLICY photos_select ON photos
    FOR SELECT TO community_app_exists
    USING (
        deleted_at IS NULL
        AND app_can_view_tier(
              (SELECT a.log_id FROM albums a WHERE a.id = photos.album_id),
              photos.visibility
            )
        AND app_can_view_tier(
              (SELECT a.log_id FROM albums a WHERE a.id = photos.album_id),
              (SELECT a.visibility FROM albums a WHERE a.id = photos.album_id)
            )
    );

CREATE POLICY photos_insert ON photos FOR INSERT TO community_app_exists
    WITH CHECK ((SELECT a.log_id FROM albums a WHERE a.id = photos.album_id) = app_current_user_id());
CREATE POLICY photos_update ON photos FOR UPDATE TO community_app_exists
    USING ((SELECT a.log_id FROM albums a WHERE a.id = photos.album_id) = app_current_user_id())
    WITH CHECK ((SELECT a.log_id FROM albums a WHERE a.id = photos.album_id) = app_current_user_id());
CREATE POLICY photos_delete ON photos FOR DELETE TO community_app_exists
    USING ((SELECT a.log_id FROM albums a WHERE a.id = photos.album_id) = app_current_user_id());

COMMIT;
