-- 🔒 1회성 운영 보정 SQL(2026-10-20, design-review 라운드) — 앱 body 계약 위반
-- 데이터(시드 콘텐츠 + 구버전 news-bot/admin-digest HTML 래핑 발행물)를 플레인 국제(컴포저 저장 형식)로 환원한다. 코드는 같은 날 src/news-bot.ts·src/admin-digest.ts에서 수정 완료 — 재발하면 이 스크립트가 아닌 코드 원인부터 확인.
CREATE FUNCTION pg_temp.html_to_plain(b text) RETURNS text AS $$
DECLARE
  v text := b;
BEGIN
  v := regexp_replace(v, '<a [^>]*>', '', 'g');
  v := regexp_replace(v, '</a>', '', 'g');
  v := regexp_replace(v, '<br[ ]*/?>', '', 'gi');
  v := regexp_replace(v, '<p>|<strong>|</strong>|<code>|</code>', '', 'g');
  v := regexp_replace(v, '</p>', E'\n\n', 'g');
  v := regexp_replace(v, E'\n{3,}', E'\n\n', 'g');
  v := replace(replace(replace(replace(replace(v,
    '&lt;', E'<'), '&gt;', E'>'), '&quot;', E'"'), '&#39;', ''''), '&amp;', E'&');
  RETURN btrim(v);
END;
$$ LANGUAGE plpgsql;

BEGIN;
UPDATE posts SET body = pg_temp.html_to_plain(body) WHERE body LIKE '%<p>%';
UPDATE comments SET body = pg_temp.html_to_plain(body) WHERE body LIKE '%<p>%';
COMMIT;
SELECT count(*) FILTER (WHERE body LIKE '%<%') AS leftovers, count(*) AS total FROM posts;
SELECT count(*) FILTER (WHERE body LIKE '%<%') AS comment_leftovers, count(*) AS total FROM comments;
