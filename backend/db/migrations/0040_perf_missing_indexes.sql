-- 0040 — 성능 점검(2026-08-22, "전체 코드를 분석해서 performance를
-- 최적화 시켜줘")에서 발견한 누락 인덱스 5개.
--
-- 🔒 CONCURRENTLY를 안 쓴 이유 — scripts/migrate.ts는 파일 내용을
-- client.query(sql) 한 번으로 통째로 보낸다. pg가 여러 statement가 든
-- 문자열을 simple query protocol로 보내면 Postgres가 전체를 암시적
-- 트랜잭션 블록으로 묶는데, CREATE INDEX CONCURRENTLY는 트랜잭션 블록
-- 안에서 실행 자체가 거부된다. 이 프로젝트 규모(개인/소규모 서비스)에선
-- 평범한 CREATE INDEX의 짧은 락이 실질적 문제가 안 돼 다른 마이그레이션과
-- 같은 BEGIN/COMMIT 패턴을 그대로 따른다.

BEGIN;

-- 1) 카테고리 피드(fetchCategoryFeed)·인기순 집계(computePopularity) 둘 다
--    "WHERE category_id = $1 [AND created_at ...] ORDER BY created_at"
--    패턴인데 지원하는 인덱스가 없었다 — 카테고리 페이지 조회마다 Seq
--    Scan. 커뮤니티 글(category_id IS NOT NULL)만 대상이라 부분 인덱스로
--    충분하다(market_posts_category_created_idx와 같은 패턴).
CREATE INDEX posts_category_created_idx
    ON posts (category_id, created_at DESC)
    WHERE category_id IS NOT NULL;

-- 2) 프로필 페이지(fetchUserLogByUsername의 post_count 서브쿼리,
--    app_post_like_count/app_post_comment_count 0025/0032 함수)와
--    "내 로그" 피드(fetchHomeFeedForLog/fetchMediaPostsForLog의
--    author_id OR log_id) 전부 author_id로 posts를 걸렀는데 인덱스가
--    없었다.
CREATE INDEX posts_author_created_idx
    ON posts (author_id, created_at DESC);

-- 3) 위 OR 조건의 log_id 쪽 — 게시판 글은 log_id가 항상 NULL이라 부분
--    인덱스로 충분하다.
CREATE INDEX posts_log_created_idx
    ON posts (log_id, created_at DESC)
    WHERE log_id IS NOT NULL;

-- 4) participants의 PK는 (thread_id, user_id) 복합키라 user_id 단독
--    조회(메시지함 목록 fetchThreads, DM 시작 findOrCreateDirectThread)를
--    못 받쳐줘 매번 참가자 테이블 전체를 스캔했다.
CREATE INDEX participants_user_idx
    ON participants (user_id);

-- 5) 관리자 유저 검색(moderation.ts searchUsers)이
--    "WHERE lower(username) LIKE lower($1) || '%'"로 조회하는데
--    username엔 원본 컬럼 UNIQUE 인덱스만 있어 lower() 래핑과 안 맞았다.
--    항상 접두어 매칭이라(중간·끝 와일드카드 없음) bigm 없이 일반 btree
--    표현식 인덱스로 충분하다.
CREATE INDEX users_username_lower_idx
    ON users (lower(username));

COMMIT;
