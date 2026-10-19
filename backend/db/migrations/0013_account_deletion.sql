-- 0013 — 탈퇴 (§6.1 "안내 → 확인 → 완료 3단계")
--
-- users를 하드 삭제한다. posts/reactions/friendships/blocks/auth_credentials/
-- oauth_identities/토큰 테이블 전부 ON DELETE CASCADE로 이미 걸려 있어서
-- (0001/0012) users 행 하나만 지우면 연쇄적으로 정리된다. CASCADE는 FK
-- 제약 자체가 수행하므로 자식 테이블 각각에 별도 DELETE GRANT가 필요 없다
-- — users에 대한 DELETE 권한만 있으면 된다.
--
-- 소프트 삭제(users.deleted_at)는 쓰지 않는다 — PRD §6.1에 유예기간·재활성화
-- 요구가 없고, 있는 채로 두면 "탈퇴했는데 검색에 여전히 뜬다" 같은 새로운
-- RLS 구멍을 또 만들게 된다. 나중에 유예기간이 필요해지면 그건 새 요구사항
-- 이지 이 마이그레이션의 확장이 아니다.

BEGIN;

GRANT DELETE ON users TO community_app_auth;

COMMIT;
