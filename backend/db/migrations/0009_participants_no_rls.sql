-- 0009 — participants: RLS 자기 재귀 수정
--
-- 🔒 실측 오류: "stack depth limit exceeded"
--
-- participants_select 정책이 app_is_participant(thread_id)를 호출했고,
-- 그 함수는 participants를 다시 SELECT한다. participants에 RLS가 걸려
-- 있으므로 그 재조회도 다시 participants_select를 평가하고, 그게 다시
-- app_is_participant를 부르는 무한 재귀였다.
--
-- friendships·blocks에서 이미 같은 이유로 RLS를 안 걸기로 했다(0001/0002 주석
-- 참조). participants도 같은 처지다 — "참여자인지"를 판정하려면 participants
-- 자신을 봐야 하는데, 그 봄 자체가 다시 판정을 요구하면 끝나지 않는다.
--
-- 해법: participants는 RLS를 걷어내고, 이를 참조하는 쪽
-- (message_threads·messages·message_requests)의 정책이 보호를 담당한다.
-- participants를 직접 SELECT하는 앱 코드는 반드시 WHERE thread_id = :t
-- AND app_is_participant(:t) 형태로 스스로를 스코프해야 한다 — friendships/
-- blocks와 동일한 운영 규율이다.

BEGIN;

DROP POLICY participants_select ON participants;
DROP POLICY participants_insert ON participants;
DROP POLICY participants_update ON participants;
DROP POLICY participants_delete ON participants;

ALTER TABLE participants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE participants DISABLE ROW LEVEL SECURITY;

COMMIT;
