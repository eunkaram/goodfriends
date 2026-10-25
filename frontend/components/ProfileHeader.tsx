'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserLogProfile, RelationshipStatus, ProfileLink } from '../lib/user-log.ts';
import { interestEligibleCategories } from '../lib/category-group-colors.ts';
import { RelationshipButton } from './RelationshipButton.tsx';
import { ProfileEditModal } from './ProfileEditModal.tsx';
import { LinkIcon } from './LinkIcon.tsx';
import type { GnbCategoryGroup } from './Gnb.tsx';
import styles from './ProfileHeader.module.css';
// 🔒 사용자 지시(2026-08-22, "프로필 편집버튼을 삼점 메뉴로") — PostCardMenu·
// PostDetailMenu와 같은 "···" 메뉴 시각 언어를 그대로 재사용한다(클래스만
// 가져오고 아이콘은 그 두 파일처럼 이 파일에도 로컬로 둔다 — 기존 관례).
import menuStyles from './PostCard.module.css';

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

/* 🔒 사용자 제시 스크린샷(2026-08, "가입일 2021.03") — artifact의
   `{{ profile.joined }}` 표시 형식이 "YYYY년 M월"이 아니라 점으로 구분한
   "YYYY.MM"(월 2자리 고정)이었다. */
function joinedLabel(iso: string): string {
  const d = new Date(iso);
  return `가입일 ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Claude Design 확정안(artifact `showProfile`/`showOtherProfile`) 프로필
 * 헤더 — 디코딩 원본 line 872-899(본인)/747-772(타인) 실측.
 * 🔒 아바타는 artifact가 이 화면에서만 쓰는 색(`#dee8ff`/`#584a6b`)을 그대로
 * 안 베끼고, 이 앱의 다른 모든 아바타(PostCard·HomeSidebars·PostComposerModal)
 * 와 같은 중성 톤(`--chip-bg`/`--text-secondary`)으로 통일했다 — CLAUDE.md에
 * 이미 기록된 "artifact 자체의 화면별 아바타 색 불일치"를 그대로 안 베끼는
 * 원칙을 이번에도 지켰다.
 *
 * 🔒 후속(2026-08, "링크... 여러개 입력 받고 싶어") — 고정 3필드(링크/
 * 인스타그램/트위터, self/other 비대칭 노출)를 `profileLinks`(임의 개수)
 * 목록으로 교체했다. artifact의 self/other 비대칭은 "고정된 두 소셜
 * 아이콘"을 전제로 한 레이아웃이라 임의 개수 목록엔 안 맞아서, 이번엔 뷰어
 * 구분 없이 모두에게 같은 칩 줄로 보여준다(§4.3과 무관 — 어차피
 * profile_links RLS가 user_logs와 같은 공개범위를 적용해 이미 걸러진
 * 목록만 내려온다).
 */
export function ProfileHeader({
  log,
  relationshipStatus,
  isFollowing,
  initialEmail,
  initialHasPassword,
  categoryTree,
}: {
  log: UserLogProfile;
  relationshipStatus: RelationshipStatus;
  isFollowing: boolean;
  /** 🔒 본인 시점 전용(auth_credentials, src/auth.ts getUserEmail) —
   * 소셜 전용 계정은 null일 수 있다. */
  initialEmail: string | null;
  /** 🔒 이메일 변경 시 비밀번호 재확인을 요구할지(updateEmail 재인증, src/auth.ts hasPassword) — 본인 시점 전용. */
  initialHasPassword: boolean;
  /** 편집 모달의 "관심 분야" 선택지(interestEligibleCategories) 계산용 —
   * 좌 사이드바와 같은 카테고리 트리를 그대로 재사용한다. */
  categoryTree: GnbCategoryGroup[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [nickname, setNickname] = useState(log.nickname);
  const [username, setUsername] = useState(log.username);
  const [intro, setIntro] = useState(log.intro);
  const [avatarUrl, setAvatarUrl] = useState(log.avatarUrl);
  const [profileLinks, setProfileLinks] = useState<ProfileLink[]>(log.profileLinks);
  const [messaging, setMessaging] = useState(false);
  const isSelf = relationshipStatus === 'self';

  function onEditClick() {
    setMenuOpen(false);
    setEditOpen(true);
  }

  async function onLogoutClick() {
    if (loggingOut) return;
    setMenuOpen(false);
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  function onDeleteAccountClick() {
    setMenuOpen(false);
    router.push('/account/delete');
  }

  async function onMessage() {
    if (messaging) return;
    setMessaging(true);
    try {
      const res = await fetch('/api/messages/thread', { method: 'POST', body: JSON.stringify({ otherUserId: log.userId }) });
      if (!res.ok) return;
      const { threadId } = (await res.json()) as { threadId: string };
      router.push(`/messages?thread=${threadId}`);
    } finally {
      setMessaging(false);
    }
  }

  return (
    <div className={styles.header}>
      <div className={styles.top}>
        <div className={styles.identity}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatar} aria-hidden="true">
              {initial(nickname)}
            </span>
          )}
          <div className={styles.identityText}>
            <div className={styles.nameRow}>
              <span className={styles.name}>{nickname}</span>
            </div>
            {/* 🔒 goodfriends CLAUDE.md 3. 정해진 제품 규칙 — "실명과 @아이디는
                어떤 화면에도 노출하지 않는다(아이디는 프로필 편집 화면에서만)",
                "지역·위치 정보는 어디에도 넣지 않는다". @아이디·location 표시 제거. */}
            <div className={styles.metaRow}>
              <span>{joinedLabel(log.joinedAt)}</span>
            </div>
          </div>
        </div>

        {isSelf ? (
          <div className={menuStyles.menuWrap}>
            <button type="button" className={menuStyles.menuTrigger} onClick={() => setMenuOpen((v) => !v)} aria-label="더보기">
              <DotsIcon />
            </button>
            {menuOpen && (
              <>
                <div className={menuStyles.menuOverlay} onClick={() => setMenuOpen(false)} />
                <div className={menuStyles.menuPopover}>
                  <button type="button" className={menuStyles.menuItem} onClick={onEditClick}>
                    <EditIcon />
                    프로필 편집
                  </button>
                  <button type="button" className={menuStyles.menuItem} onClick={onLogoutClick} disabled={loggingOut}>
                    <LogoutIcon />
                    {loggingOut ? '로그아웃 중…' : '로그아웃'}
                  </button>
                  <button type="button" className={menuStyles.menuItemDanger} onClick={onDeleteAccountClick}>
                    <TrashIcon />
                    계정 삭제
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className={styles.actions}>
            {/* §6.6 진입점 표 — "프로필/로그 헤더... 전체 → 친구=스레드 / 비친구=요청".
                findOrCreateDirectThread가 차단 여부·친구 여부를 판정해 즉시
                스레드를 만들거나(친구) 요청함으로 만든다(비친구) — 여기선
                결과를 신경 안 쓰고 그 스레드로 이동만 시킨다. */}
            <button type="button" className={styles.messageBtn} onClick={onMessage} disabled={messaging}>
              메시지
            </button>
            <RelationshipButton targetUserId={log.userId} initialStatus={relationshipStatus} initialFollowing={isFollowing} isLoggedIn={true} />
          </div>
        )}
      </div>

      {intro && <p className={styles.bio}>{intro}</p>}

      {profileLinks.length > 0 && (
        <div className={styles.linksRow}>
          {profileLinks.map((l) => (
            <a key={l.id} className={styles.linkChip} href={l.url} target="_blank" rel="noopener noreferrer">
              <LinkIcon url={l.url} size={13} />
              {l.name}
            </a>
          ))}
        </div>
      )}

      {editOpen && (
        <ProfileEditModal
          nickname={nickname}
          username={username}
          intro={intro}
          email={initialEmail}
          hasPassword={initialHasPassword}
          avatarUrl={avatarUrl}
          links={profileLinks}
          onLinksChange={setProfileLinks}
          visibility={log.visibility === 'private' || log.visibility === 'followers' ? log.visibility : 'public'}
          interests={log.interests}
          stack={log.stack}
          interestOptions={interestEligibleCategories(categoryTree)}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => {
            setNickname(next.nickname);
            setIntro(next.intro);
            setAvatarUrl(next.avatarUrl);
            if (next.username !== username) {
              // 🔒 아이디는 /@{username} URL의 정체성이라, 바뀌면 지금 보고
              // 있는 라우트 자체가 낡은 값이 된다 — router.refresh()로는 같은
              // URL을 다시 그릴 뿐이라 새 아이디로 실제 이동시킨다.
              router.push(`/@${next.username}`);
              return;
            }
            setUsername(next.username);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
