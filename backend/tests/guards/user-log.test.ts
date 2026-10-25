/**
 * 개인 로그 — §6.4, §11.7.6, §4.3(비로그인 전면 차단), §6.5 관계 상태 머신.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ownerPool } from '../../src/db.ts';
import {
  createDefaultUserLog,
  fetchUserLogByUsername,
  fetchLogPosts,
  fetchRelationshipStatus,
  fetchFollowStatus,
  updateProfile,
  fetchFriends,
  previewPostalLocation,
} from '../../src/user-log.ts';

let owner: pg.Pool;
let alice: string;
let bob: string;
let carol: string; // alice가 차단
let dana: string; // username/location/link/통계 전용 신규 사용자 — alice/bob 픽스처를 안 건드리기 위해 분리
let erin: string; // dana와의 username 중복확인·팔로워/공통친구 상대
let dailyChatId: string;

beforeAll(async () => {
  owner = ownerPool();
  await owner.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'ULOG::%')`);
  await owner.query(`DELETE FROM posts WHERE title LIKE 'ULOG::%'`);
  await owner.query(`DELETE FROM users WHERE username LIKE 'ulog_%'`);

  const u = await owner.query<{ id: string; username: string }>(
    `INSERT INTO users (username) VALUES ('ulog_alice'), ('ulog_bob'), ('ulog_carol'), ('ulog_dana'), ('ulog_erin') RETURNING id, username`,
  );
  alice = u.rows.find((r) => r.username === 'ulog_alice')!.id;
  bob = u.rows.find((r) => r.username === 'ulog_bob')!.id;
  carol = u.rows.find((r) => r.username === 'ulog_carol')!.id;
  dana = u.rows.find((r) => r.username === 'ulog_dana')!.id;
  erin = u.rows.find((r) => r.username === 'ulog_erin')!.id;

  const cat = await owner.query<{ id: string }>(`SELECT id FROM categories WHERE slug = 'free'`);
  dailyChatId = cat.rows[0].id;

  await owner.query(`INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)`, [alice, carol]);
});

afterAll(async () => {
  await owner?.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`, [
    [alice, bob, dana, erin],
  ]);
  await owner?.query(`DELETE FROM follows WHERE follower_id = ANY($1::uuid[]) OR followee_id = ANY($1::uuid[])`, [[alice, bob, dana, erin]]);
  await owner?.query(`DELETE FROM blocks WHERE blocker_id = $1`, [alice]);
  await owner?.query(`DELETE FROM comments WHERE target_id IN (SELECT id FROM posts WHERE title LIKE 'ULOG::%')`);
  await owner?.query(`DELETE FROM posts WHERE title LIKE 'ULOG::%'`);
  await owner?.query(`DELETE FROM user_logs WHERE user_id = ANY($1::uuid[])`, [[alice, bob, carol, dana, erin]]);
  await owner?.query(`DELETE FROM users WHERE username LIKE 'ulog_%'`);
  await owner?.end();
});

describe('createDefaultUserLog + fetchUserLogByUsername', () => {
  it('로그를 만들면 본인 조회에 잡힌다', async () => {
    await createDefaultUserLog(alice);
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.userId).toBe(alice);
    expect(log?.visibility).toBe('public');
  });

  it('멱등하다 — 두 번 호출해도 에러 없음', async () => {
    await expect(createDefaultUserLog(alice)).resolves.not.toThrow();
  });

  it('🔒 비로그인은 존재하는 로그도 못 본다(§4.3 — RLS가 app_current_user_id() IS NOT NULL을 요구)', async () => {
    expect(await fetchUserLogByUsername(null, 'ulog_alice')).toBeNull();
  });

  it('로그가 없는 사용자명은 null', async () => {
    await createDefaultUserLog(bob);
    expect(await fetchUserLogByUsername(bob, 'no_such_username')).toBeNull();
  });
});

describe('fetchLogPosts (§11.7.6 1번, 크로스포스팅 §6.4 포함)', () => {
  it('이 로그의 글만 반환한다', async () => {
    // log_id는 user_logs.user_id(=로그 주인의 user id)를 그대로 가리킨다 — 임의 uuid가 아니다.
    await owner.query(`INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'ULOG::alice log post', 'public')`, [alice]);
    const posts = await fetchLogPosts(bob, alice, 20, 0);
    expect(posts.some((p) => p.title === 'ULOG::alice log post')).toBe(true);
  });

  // 🔒 실전 발견(2026-08, 사용자 지시 — "좌측 Posts메뉴는 게시판, 공개된 개인
  // post로 구분없이") — createCommunityPost가 log_id를 안 채워서, 이 케이스가
  // 없던 그 전까지는 게시판 글이 fetchLogPosts에서 한 번도 안 잡힌 채 넘어갔다.
  it('게시판 글(category_id만 있고 log_id는 없음)도 author_id로 잡혀서 함께 반환된다', async () => {
    await owner.query(`INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'ULOG::alice board post', 'public')`, [
      alice,
      dailyChatId,
    ]);
    const posts = await fetchLogPosts(bob, alice, 20, 0);
    expect(posts.some((p) => p.title === 'ULOG::alice board post')).toBe(true);
  });

  it('최신순으로 병합된다 — 게시판 글과 로그 글이 섞여도 created_at DESC 순서를 지킨다', async () => {
    await owner.query(`DELETE FROM posts WHERE title LIKE 'ULOG::order-%'`);
    await owner.query(
      `INSERT INTO posts (author_id, log_id, title, visibility, created_at) VALUES ($1, $1, 'ULOG::order-older-log', 'public', now() - interval '2 hour')`,
      [alice],
    );
    await owner.query(
      `INSERT INTO posts (author_id, category_id, title, visibility, created_at) VALUES ($1, $2, 'ULOG::order-newer-board', 'public', now() - interval '1 hour')`,
      [alice, dailyChatId],
    );
    const posts = await fetchLogPosts(bob, alice, 20, 0);
    const titles = posts.map((p) => p.title).filter((t) => t.startsWith('ULOG::order-'));
    expect(titles).toEqual(['ULOG::order-newer-board', 'ULOG::order-older-log']);
  });
});

describe('fetchRelationshipStatus (§6.5 상태 머신)', () => {
  it('무관계면 none', async () => {
    expect(await fetchRelationshipStatus(alice, bob)).toBe('none');
  });

  it('본인 로그는 self', async () => {
    expect(await fetchRelationshipStatus(alice, alice)).toBe('self');
  });

  it('신청 후 발신자는 pending_sent, 수신자는 pending_received', async () => {
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`, [alice, bob]);
    expect(await fetchRelationshipStatus(alice, bob)).toBe('pending_sent');
    expect(await fetchRelationshipStatus(bob, alice)).toBe('pending_received');
  });

  it('수락하면 양쪽 다 friends', async () => {
    await owner.query(`UPDATE friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2`, [alice, bob]);
    expect(await fetchRelationshipStatus(alice, bob)).toBe('friends');
    expect(await fetchRelationshipStatus(bob, alice)).toBe('friends');
  });

  it('비로그인은 none', async () => {
    expect(await fetchRelationshipStatus(null, bob)).toBe('none');
  });
});

describe('fetchFollowStatus', () => {
  it('팔로우 전엔 false, 후엔 true', async () => {
    expect(await fetchFollowStatus(alice, bob)).toBe(false);
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [alice, bob]);
    expect(await fetchFollowStatus(alice, bob)).toBe(true);
  });
});

describe('updateProfile — Claude Design 확정안 프로필 편집 모달(신규)', () => {
  it('닉네임을 바꾸면 fetchUserLogByUsername이 새 값을 반영한다', async () => {
    const result = await updateProfile(alice, { nickname: 'alice_renamed' });
    expect(result.ok).toBe(true);
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.nickname).toBe('alice_renamed');
  });

  it('소개글을 바꾸면 반영된다', async () => {
    await updateProfile(alice, { intro: '안녕하세요, 앨리스입니다.' });
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.intro).toBe('안녕하세요, 앨리스입니다.');
  });

  it('공개범위를 private로 바꾸면 본인은 계속 보이고 타인은 못 본다', async () => {
    await updateProfile(alice, { visibility: 'private' });
    const ownView = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(ownView?.visibility).toBe('private');
    const otherView = await fetchUserLogByUsername(bob, 'ulog_alice');
    expect(otherView).toBeNull();

    await updateProfile(alice, { visibility: 'public' }); // 원복 — 이후 테스트에 영향 안 주게
  });

  /**
   * 🔒 사용자 지시(2026-08, "프로필 수정에서 프로필 공개를 비공개/follower/
   * 공개 로 토글버튼으로 수정해줘") — 0031이 app_can_view_tier에 'followers'
   * 분기(app_is_followed_by 재사용, posts와 같은 패턴)를 추가했다.
   */
  it('공개범위를 followers로 바꾸면 팔로워는 보이고 팔로워 아닌 사람은 못 본다', async () => {
    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)`, [bob, alice]); // bob이 alice를 팔로우
    await updateProfile(alice, { visibility: 'followers' });

    const ownView = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(ownView?.visibility).toBe('followers');

    const followerView = await fetchUserLogByUsername(bob, 'ulog_alice');
    expect(followerView).not.toBeNull();

    const strangerView = await fetchUserLogByUsername(dana, 'ulog_alice');
    expect(strangerView).toBeNull();

    await owner.query(`DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2`, [bob, alice]);
    await updateProfile(alice, { visibility: 'public' }); // 원복 — 이후 테스트에 영향 안 주게
  });

  it('빈 닉네임은 거부한다', async () => {
    const result = await updateProfile(alice, { nickname: '   ' });
    expect(result.ok).toBe(false);
  });

  it('30자를 넘는 닉네임은 거부한다', async () => {
    const result = await updateProfile(alice, { nickname: 'a'.repeat(31) });
    expect(result.ok).toBe(false);
  });

  // 🔒 REGRESSION — 닉네임은 자유 텍스트라 한글 사칭 문구('관리자' 등)가
  // 그대로 들어간다(RESERVED_NICKNAMES, src/reserved-nicknames.ts).
  it('🔒 예약어(관리자)로는 닉네임을 바꿀 수 없다', async () => {
    const before = await fetchUserLogByUsername(alice, 'ulog_alice');
    const result = await updateProfile(alice, { nickname: '관리자' });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
    const after = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(after?.nickname).toBe(before?.nickname); // 실패했으니 그대로
  });

  // 🔒 REGRESSION — 욕설은 사칭 예약어와 달리 완전일치가 아니라 포함 여부로
  // 막는다(PROFANITY_SUBSTRINGS, src/reserved-nicknames.ts) — 앞뒤에 글자를
  // 붙이는 우회("안녕씨발하세요")를 완전일치로는 막을 수 없기 때문.
  it('🔒 욕설이 포함된 닉네임은 앞뒤에 다른 글자가 있어도 거부한다', async () => {
    const result = await updateProfile(alice, { nickname: '안녕씨발하세요' });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('잘못된 visibility 값은 거부한다(RLS가 지원하는 friends는 이 토글 대상이 아니다)', async () => {
    const result = await updateProfile(alice, { visibility: 'friends' as never });
    expect(result.ok).toBe(false);
  });

  it('타인의 프로필은 건드릴 수 없다 — userId는 항상 세션 본인만 가리킨다', async () => {
    await updateProfile(bob, { nickname: 'bob_should_not_touch_alice' });
    const aliceLog = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(aliceLog?.nickname).not.toBe('bob_should_not_touch_alice');
  });

  it('postCount는 이 로그의 글 수를 정확히 센다', async () => {
    const before = await fetchUserLogByUsername(bob, 'ulog_bob');
    await owner.query(`INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'ULOG::count post', 'public')`, [bob]);
    const after = await fetchUserLogByUsername(bob, 'ulog_bob');
    expect(after!.postCount).toBe((before?.postCount ?? 0) + 1);
  });

  /**
   * 🔒 실전 버그(2026-08, 사용자 발견 — "프로필 페이지의 글... 데이터가
   * 제대로 잘 나오는지 확인해줘. 잘 안나오는것 같아") — postCount가
   * log_id 기준이라 커뮤니티 게시판 글(category_id 있는 글)이 전부
   * 빠지고 있었다(실측 — 전체 13개 중 1개만 잡힌 계정 발견). 위 테스트는
   * log_id도 같이 채운 픽스처(author_id=log_id=bob)라 이 버그를 못
   * 잡았다 — 게시판 글(log_id는 NULL)만으로 별도 검증한다.
   */
  it('postCount는 게시판 글(log_id 없음)도 센다', async () => {
    const before = await fetchUserLogByUsername(bob, 'ulog_bob');
    await owner.query(`INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'ULOG::board count post', 'public')`, [
      bob,
      dailyChatId,
    ]);
    const after = await fetchUserLogByUsername(bob, 'ulog_bob');
    expect(after!.postCount).toBe((before?.postCount ?? 0) + 1);
  });

  it('commentCount는 내 글들이 받은 댓글 총합을 정확히 센다', async () => {
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'ULOG::comment count post', 'public') RETURNING id`,
      [bob, dailyChatId],
    );
    const before = await fetchUserLogByUsername(bob, 'ulog_bob');
    await owner.query(`INSERT INTO comments (target_type, target_id, author_id, body) VALUES ('post', $1, $2, 'nice')`, [post.rows[0].id, alice]);
    const after = await fetchUserLogByUsername(bob, 'ulog_bob');
    expect(after!.commentCount).toBe((before?.commentCount ?? 0) + 1);
  });
});

/**
 * 🔒 사용자 지시(2026-10, "프로필 페이지의... 오른쪽영역을 디자인 시안대로
 * 처리해줘") — goodfriends 우측 프로필 위젯(관심 분야·스택·활동 히트맵).
 * profile_fields(0006)는 지금까지 테이블만 있고 아무 기능도 안 썼다 —
 * RLS 자체는 profile-field.test.ts가 이미 범용으로 검증했으므로, 여기선
 * 이 두 키(interests/stack)에 특화된 검증(허용 목록·개수 제한)과 활동
 * 히트맵 집계만 확인한다.
 */
describe('updateProfile — 관심 분야/스택/활동(신규)', () => {
  it('허용된 카테고리 slug로 관심 분야를 저장하고 그대로 읽힌다', async () => {
    const result = await updateProfile(alice, { interests: ['local', 'coding'] });
    expect(result).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.interests.sort()).toEqual(['coding', 'local']);
  });

  it('목록에 없는 slug(news·qna·free 포함)는 거부한다', async () => {
    expect(await updateProfile(alice, { interests: ['news'] })).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(await updateProfile(alice, { interests: ['존재하지않는카테고리'] })).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('6개 이상(최대 5개)은 거부한다', async () => {
    const result = await updateProfile(alice, {
      interests: ['local', 'coding', 'automation', 'creative', 'aiservice', 'frontier'],
    });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('빈 배열로 저장하면 관심 분야가 비워진다', async () => {
    await updateProfile(alice, { interests: [] });
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.interests).toEqual([]);
  });

  it('고정된 3그룹(모델/도구/장비)에 자유 텍스트 스택을 저장하고 그대로 읽힌다', async () => {
    const result = await updateProfile(bob, { stack: { 모델: ['Claude', 'Qwen'], 도구: ['Ollama'], 장비: [] } });
    expect(result).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(bob, 'ulog_bob');
    expect(log?.stack).toEqual({ 모델: ['Claude', 'Qwen'], 도구: ['Ollama'], 장비: [] });
  });

  it('고정 3그룹에 없는 키는 거부한다', async () => {
    const result = await updateProfile(bob, { stack: { 프레임워크: ['React'] } });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  // 🔒 사용자 지시(2026-10, "모델, 도구, 장비는 각각 최대 5개씩만") — 12 → 5.
  it('그룹당 5개를 넘는 항목은 거부한다', async () => {
    const result = await updateProfile(bob, { stack: { 모델: Array.from({ length: 6 }, (_, i) => `m${i}`), 도구: [], 장비: [] } });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('그룹당 정확히 5개는 허용한다', async () => {
    const result = await updateProfile(bob, { stack: { 모델: Array.from({ length: 5 }, (_, i) => `m${i}`), 도구: [], 장비: [] } });
    expect(result).toEqual({ ok: true });
  });

  it('24자를 넘는 항목 이름은 거부한다', async () => {
    const result = await updateProfile(bob, { stack: { 모델: ['a'.repeat(25)], 도구: [], 장비: [] } });
    expect(result).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('activity — 최근 20주(140일)를 주 단위로 묶어 돌려준다', async () => {
    const log = await fetchUserLogByUsername(alice, 'ulog_alice');
    expect(log?.activity.recentWeeks).toHaveLength(20);
    expect(log?.activity.recentWeeks.every((w) => w.days.length === 7)).toBe(true);
  });

  it('activity — 오늘 쓴 글이 오늘 칸의 카운트에 즉시 반영된다', async () => {
    const before = await fetchUserLogByUsername(alice, 'ulog_alice');
    const todayBefore = before!.activity.recentWeeks.at(-1)!.days.at(-1)!;
    await owner.query(`INSERT INTO posts (author_id, category_id, title, visibility) VALUES ($1, $2, 'ULOG::activity post', 'public')`, [
      alice,
      dailyChatId,
    ]);
    const after = await fetchUserLogByUsername(alice, 'ulog_alice');
    const todayAfter = after!.activity.recentWeeks.at(-1)!.days.at(-1)!;
    expect(todayAfter.date).toBe(todayBefore.date);
    expect(todayAfter.count).toBe(todayBefore.count + 1);
  });
});

/**
 * 🔒 사용자 지시(2026-08, "profile페이지를... 목업UI와 완벽하게 싱크되어야해") —
 * 이전 라운드가 "URL 정체성이라 편집 UI 자체를 안 넣었다"고 뺐던 아이디가
 * 이번에 처음 편집 가능해졌다. alice/bob 픽스처를 건드리면 앞선 테스트들이
 * 참조하는 'ulog_alice'/'ulog_bob'이 깨지므로 전용 사용자(dana/erin)를 쓴다.
 */
describe('updateProfile — 아이디(username) 편집(신규)', () => {
  beforeAll(async () => {
    await createDefaultUserLog(dana);
    await createDefaultUserLog(erin);
  });

  it('형식에 맞는 새 아이디로 바꾸면 그 아이디로 조회된다', async () => {
    const result = await updateProfile(dana, { username: 'ulog_dana_renamed' });
    expect(result).toEqual({ ok: true });
    expect(await fetchUserLogByUsername(dana, 'ulog_dana_renamed')).not.toBeNull();
    expect(await fetchUserLogByUsername(dana, 'ulog_dana')).toBeNull(); // 옛 아이디는 더 이상 없다

    await updateProfile(dana, { username: 'ulog_dana' }); // 원복 — 이후 테스트에 영향 안 주게
  });

  it('대문자는 소문자로 정규화되어 받아들여진다', async () => {
    // 🔒 프론트(ProfileEditModal)가 입력 즉시 toLowerCase()하는 것과 같은
    // 정규화를 서버도 한다 — API를 직접 두드려도 결과가 같아야 한다.
    expect(await updateProfile(dana, { username: 'ULOG_DANA' })).toEqual({ ok: true });
    expect(await fetchUserLogByUsername(dana, 'ulog_dana')).not.toBeNull();
  });

  it('짧거나 공백이 섞이면 거부한다', async () => {
    expect(await updateProfile(dana, { username: 'ab' })).toEqual({ ok: false, error: 'INVALID_INPUT' }); // 3자 미만
    expect(await updateProfile(dana, { username: 'has space' })).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  it('이미 다른 사람이 쓰는 아이디로는 바꿀 수 없다', async () => {
    expect(await updateProfile(dana, { username: 'ulog_erin' })).toEqual({ ok: false, error: 'USERNAME_TAKEN' });
    // 실패했으니 dana의 아이디는 그대로여야 한다
    expect(await fetchUserLogByUsername(dana, 'ulog_dana')).not.toBeNull();
  });

  it('자기 자신의 현재 아이디로 "바꿔도" 중복으로 안 잡힌다(멱등)', async () => {
    expect(await updateProfile(dana, { username: 'ulog_dana' })).toEqual({ ok: true });
  });

  // 🔒 REGRESSION — RESERVED_USERNAMES(src/reserved-usernames.ts)는 가입 시
  // 자동생성(auth.ts)뿐 아니라 프로필 편집으로 바꾸는 경로도 막아야 한다.
  // isUsernameAvailable() 하나를 실시간 확인·저장 재확인 둘 다 공유하므로
  // 여기 하나만 고치면 되지만, 실제로 반영됐는지는 이 경로로 직접 확인해야 한다.
  it('🔒 예약어(admin)로는 프로필에서 아이디를 바꿀 수 없다', async () => {
    expect(await updateProfile(dana, { username: 'admin' })).toEqual({ ok: false, error: 'USERNAME_TAKEN' });
    expect(await fetchUserLogByUsername(dana, 'ulog_dana')).not.toBeNull(); // 실패했으니 그대로
  });
});

/**
 * 🔒 사용자 지시(2026-08, "zipcode를 입력하면 자동으로 지역을 처리해야해...
 * zipcode저장시 국가와 zip코드를 확인하고 잘못된 경우 에러를 띄워줘야해") —
 * 자유 텍스트 location(0025)이 이 라운드에서 country/postalCode 쌍으로
 * 완전히 대체됐다(0028이 user_logs.location 컬럼 자체를 드롭).
 */
describe('updateProfile — 위치(country/postalCode, 신규)', () => {
  it('국가·우편번호를 안 채운 픽스처는 위치가 null이다', async () => {
    const log = await fetchUserLogByUsername(dana, 'ulog_dana');
    expect(log?.location).toBeNull();
  });

  it('국가 없이 우편번호만 보내면 검증 대상이 없어 거부한다', async () => {
    expect(await updateProfile(dana, { postalCode: '06236' })).toEqual({ ok: false, error: 'INVALID_INPUT' });
  });

  // 0049 — 국가 목록 검증(COUNTRIES)은 1차 스코프에서 제외됐다: 2글자 ISO
  // 형식만 확인하고 어떤 코드든 받는다(ZZ 포함).
  it('2글자 ISO 형식이면 어떤 코드든 받는다(목록 검증은 1차에서 제외)', async () => {
    expect(await updateProfile(dana, { country: 'ZZ' })).toEqual({ ok: true });
  });

  /**
   * 🔒 사용자 발견(2026-08, "미국 zipcode 19134를 입력했는데 일치하는
   * 위치가 없대. 정상적인 zipcode야") — 원래는 postal_code_index에 실제로
   * 존재하는 조합만 저장을 허용했는데, 그 표는 §17.3에 문서화된 대로
   * "미국 5곳+한국 3곳만 시드한 대표값"이라 실제 사용자 대부분의 정상적인
   * 우편번호를 거부하고 있었다 — 존재 여부가 아니라 형식만 검증하도록
   * 낮췄다(isValidPostalCodeFormat).
   *
   * 🔒 사용자 지시(2026-08, "zipcode로 지역을 검색하기 위해 DB를 구성해줘")
   * — postal_code_index가 이제 GeoNames 파생 미국 41,488행+한국 34,249행
   * 전체 데이터셋이라(scripts/seed-postal-codes.ts) 19134도 더 이상
   * "대표값 8곳"에 없는 예시가 아니라 실제로 매치되는 행(Philadelphia,
   * PA)이 됐다 — "매치 안 되는 예시"는 두 나라 모두에 존재하지 않는
   * 00000으로 바꿨다.
   */
  it('형식 자체가 잘못된 우편번호는 INVALID_LOCATION으로 거부한다', async () => {
    expect(await updateProfile(dana, { country: 'KR', postalCode: 'abc' })).toEqual({ ok: false, error: 'INVALID_LOCATION' });
    expect(await updateProfile(dana, { country: 'US', postalCode: '123' })).toEqual({ ok: false, error: 'INVALID_LOCATION' });
  });

  it('형식은 맞지만 postal_code_index엔 없는 우편번호도 저장은 허용된다 — 도시 없이 국가코드만 표시', async () => {
    expect(await updateProfile(dana, { country: 'US', postalCode: '00000' })).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(dana, 'ulog_dana');
    expect(log?.location).toBe('US'); // 0049 —우편번호 시드가 없어 city 매치 없음, 국가코드만
  });

  it('우편번호가 매치돼도(시드 앖음) 저장은 되고 위치는 국가코드만 표시한다', async () => {
    expect(await updateProfile(dana, { country: 'US', postalCode: '19134' })).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(dana, 'ulog_dana');
    expect(log?.location).toBe('US'); // 0049 — postal_code_index 시드 미포함
  });

  it('국가+우편번호 조합이 시드(0017)와 매치되면 도시+국가코드가 계산된다', async () => {
    expect(await updateProfile(dana, { country: 'KR', postalCode: '06236' })).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(dana, 'ulog_dana');
    expect(log?.location).toBe('서울, KR'); // 0049 — 라벨은 국가코드(대한민국 아님)
  });

  it('우편번호를 빈 문자열로 지우면 국가명만 남는다(도시 없이)', async () => {
    expect(await updateProfile(dana, { country: 'KR', postalCode: '' })).toEqual({ ok: true });
    const log = await fetchUserLogByUsername(dana, 'ulog_dana');
    expect(log?.location).toBe('KR');
  });
});

/**
 * 🔒 사용자 지시(2026-08, "zipcode를 입력하면 국가와 zipcode로 위치정보
 * (california, san jose)를 입력창 오른쪽에 보여줘") — 저장 전 편집 폼의
 * 실시간 미리보기. postal_code_index.state가 있으면(미국은 실제 주,
 * 한국은 구/군) 그 값을, 없으면 국가명을 쓴다.
 */
describe('previewPostalLocation', () => {
  // 0049 후에도 0017 시드는 그대로다 — 95110(San Jose/CA)·06236(서울/강남구)은
  // 여전히 매치되는 행이다. 변경점은 국가명 라벨만 국가코드로 표기됐다는것.
  it('state가 있는 행(미국)은 "도시, state"를 돌려준다', async () => {
    expect(await previewPostalLocation('US', '95110')).toBe('San Jose, CA');
  });

  it('state가 있는 행(한국, 구/군)도 마찬가지다', async () => {
    expect(await previewPostalLocation('KR', '06236')).toBe('서울, 강남구');
  });

  it('매치되는 행이 없으면 null', async () => {
    expect(await previewPostalLocation('KR', '00000')).toBeNull();
  });
});

describe('updateProfile — 아바타', () => {
  /**
   * 🔒 사용자 지시(2026-08, "프로필 편집 팝업에서... 이미지 업로드 기능넣어줘") —
   * avatarUrl은 POST /api/media/upload가 돌려준 URL을 그대로 받아 ProfileHeader의
   * <img src>로 렌더링된다 — link/instagram/twitter와 같은 스킴 검증 경계가
   * 그대로 적용돼야 한다.
   */
  it('아바타 URL도 http(s)://만 허용하고, 비우면 이니셜로 되돌아간다', async () => {
    expect(await updateProfile(dana, { avatarUrl: 'javascript:alert(1)' })).toEqual({ ok: false, error: 'INVALID_INPUT' });
    expect(await updateProfile(dana, { avatarUrl: 'https://cdn.example/avatars/dana.jpg' })).toEqual({ ok: true });
    expect((await fetchUserLogByUsername(dana, 'ulog_dana'))?.avatarUrl).toBe('https://cdn.example/avatars/dana.jpg');
    expect(await updateProfile(dana, { avatarUrl: '' })).toEqual({ ok: true });
    expect((await fetchUserLogByUsername(dana, 'ulog_dana'))?.avatarUrl).toBe('');
  });
});

/**
 * 🔒 팔로워 수는 follows RLS(0014, "follower_id=본인 OR followee_id=본인")를
 * SECURITY DEFINER 집계(app_follower_count)로 우회해서 세는 게 이번 라운드의
 * 핵심 변경이다 — 뷰어가 그 관계와 무관한 제3자여도 정확한 총합이 나와야 한다.
 */
describe('fetchUserLogByUsername — followerCount/likeCount(신규)', () => {
  it('팔로워 수는 뷰어가 그 관계의 당사자가 아니어도 정확하다', async () => {
    await owner.query(`DELETE FROM follows WHERE followee_id = $1`, [erin]);
    const before = await fetchUserLogByUsername(erin, 'ulog_erin');
    expect(before?.followerCount).toBe(0);

    await owner.query(`INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2), ($3, $2)`, [alice, erin, dana]);
    // 🔒 이 조회의 뷰어(bob)는 alice→erin·dana→erin 어느 관계의 당사자도 아니다 —
    // follows RLS만 탔다면 0이 나왔어야 한다.
    const after = await fetchUserLogByUsername(bob, 'ulog_erin');
    expect(after?.followerCount).toBe(2);

    await owner.query(`DELETE FROM follows WHERE followee_id = $1`, [erin]);
  });

  it('좋아요 수는 이 사람이 쓴 글들의 반응 총합이다', async () => {
    const before = await fetchUserLogByUsername(erin, 'ulog_erin');
    const post = await owner.query<{ id: string }>(
      `INSERT INTO posts (author_id, log_id, title, visibility) VALUES ($1, $1, 'ULOG::like count post', 'public') RETURNING id`,
      [erin],
    );
    await owner.query(`INSERT INTO reactions (user_id, target_type, target_id, emoticon_type) VALUES ($1, 'post', $2, 'empathy')`, [
      alice,
      post.rows[0].id,
    ]);
    const after = await fetchUserLogByUsername(erin, 'ulog_erin');
    expect(after!.likeCount).toBe((before?.likeCount ?? 0) + 1);
  });
});

/** 🔒 "N명의 공통 친구" — friendships가 RLS 없는 테이블이라(불변식 12) 앱 레이어 집계가 정확한지 직접 확인한다. */
describe('fetchFriends — mutual(신규)', () => {
  it('나와 이 친구가 공통으로 아는 친구 수를 센다', async () => {
    await owner.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`, [[dana, erin]]);
    // dana ↔ alice, dana ↔ erin, erin ↔ alice — 삼각 친구관계. dana 시점에서
    // erin과의 공통 친구는 alice 1명.
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted'), ($1, $3, 'accepted')`, [
      dana,
      alice,
      erin,
    ]);
    await owner.query(`INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`, [erin, alice]);

    const danaFriends = await fetchFriends(dana);
    const erinEntry = danaFriends.find((f) => f.id === erin);
    expect(erinEntry?.mutual).toBe(1);

    await owner.query(`DELETE FROM friendships WHERE requester_id = ANY($1::uuid[]) OR addressee_id = ANY($1::uuid[])`, [[dana, erin]]);
  });
});
