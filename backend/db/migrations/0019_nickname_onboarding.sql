-- 0019 — 가입 항목 정리: 성/이름 → 닉네임, 거주 국가 제거 (사용자 지시, 2026-08)
--
-- SNS 로그인이 실제로 주는 항목(닉네임/이메일)과 이메일 가입 폼이 요구하던
-- 항목(성·이름 분리, 거주 국가)이 어긋나 있었다 — SNS 가입은 후자 둘을
-- 영원히 못 채웠다(온보딩이 없었음, /review 발견). 이 마이그레이션은 그
-- 불일치를 없앤다: 성/이름을 닉네임 하나로 합치고, 거주 국가는 가입
-- 항목에서 완전히 뺀다.
--
-- ⚠️ country 컬럼 자체는 남겨둔다 — market.ts의 resolveUserLatLng()이
-- (users.country, users.postal_code) → postal_code_index 조인으로 "내 위치
-- 기준 거리순" 좌표를 찾는다. 컬럼을 지우면 그 쿼리가 SQL 에러로 깨진다.
-- 이제 이 컬럼은 앞으로 전부 NULL로 남는다 — JOIN이 그냥 매치를 못 찾을
-- 뿐이라 §7에 이미 있는 "우편번호 미등록 시 최신순 폴백"으로 조용히
-- 흡수된다(에러 아님). 대신 신규 가입자는 "내 위치 기준 거리순" 정렬이
-- 영구히 비활성 상태가 된다 — 마켓 글쓰기 시 국가 선택은 여전히 받으므로
-- 판매 글 자체의 거리 정보는 안 끊긴다. 이 트레이드오프는 CLAUDE.md에도 기록.

BEGIN;

-- 🔒 NOT NULL로 걸지 않는다 — first_name/last_name/country/postal_code와
-- 같은 이유: 이 프로젝트의 다른 스무 개 남짓 테스트 파일이 인증 흐름과
-- 무관하게 `INSERT INTO users (username) VALUES (...)`만으로 픽스처를
-- 만든다(실측 확인 — NOT NULL로 걸었더니 그 전부가 깨졌다). 앱 레이어
-- (signUpWithEmail/findOrCreateOAuthUser)는 항상 값을 채운다 — 실사용자
-- 행에 NULL 닉네임이 생기는 경로는 없다.
ALTER TABLE users ADD COLUMN nickname text;

UPDATE users
SET nickname = COALESCE(NULLIF(trim(coalesce(last_name, '') || coalesce(first_name, '')), ''), username);

ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;

COMMENT ON COLUMN users.country IS
  '2026-08부로 가입 시 더 이상 수집하지 않는다(0019) — 항상 NULL. market.ts의 '
  '거리 계산 JOIN이 참조하므로 컬럼 자체는 남겨뒀다. 지우지 말 것.';

COMMIT;
