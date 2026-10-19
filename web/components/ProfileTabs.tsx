'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PostCard } from './PostCard.tsx';
import { BodyContent } from './BodyContent.tsx';
import { relativeTime } from './relative-time.ts';
import { ReactionIcon } from './ReactionIcons.tsx';
import type { FeedPost } from '../lib/feed.ts';
import type { PostWithUserComments, UserComment } from '../lib/user-log.ts';
import type { FollowerListItem } from '../lib/relationships.ts';
import styles from './ProfileTabs.module.css';
// 🔒 사용자 지시(2026-08, "replies의 댓글 부분 디자인을 글 내용보기 댓글
// 디자인을 적용해줘") — 댓글 항목(.comment/.avatar/.commentBody 등)을
// CommentSection과 그대로 공유한다.
import commentStyles from './CommentSection.module.css';

/** CommentSection.tsx의 ReplyIcon과 같은 SVG — 그 파일이 export하지 않아 그대로 복제(이 코드베이스의 다른 아이콘들처럼 파일별 로컬 정의). */
function ReplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

const TAB_LABELS = ['Post', 'Replies', 'Media', 'Follower'] as const;
const FRIEND_COLORS = ['#f0d8db', '#dee8ff', '#dee0e1', '#e8dceb', '#f0d8db', '#dee8ff'];

function MessageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.2L19.5 4.5l-5 15-2.6-6-6-1.3z" />
    </svg>
  );
}

/** PostCardMenu.tsx의 DotsIcon과 같은 SVG — 그 파일이 export하지 않아 그대로 복제. */
function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function UnfollowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="8" x2="23" y2="8" />
    </svg>
  );
}

/**
 * 🔒 사용자 지시(2026-08-26, "프로필 페이지의 친구 탭을 folower로 변경하고,
 * 내용도 follower들의 리스트를 보여줘") — 옛 FriendCard를 재사용하되
 * 팔로워에 안 맞는 부분을 걷어냈다: "N명의 공통 친구"(mutual, FriendUser
 * 전용 필드)는 표시할 데이터가 없어 @username으로 교체.
 *
 * 🔒 후속(2026-08-26, "메세지 아이콘 대신 삼점메뉴를 넣고 삼점버튼 클릭시
 * 메세지, 팔로잉 취소 메뉴를 띄우게") — 메시지 아이콘 단일 버튼을 PostCardMenu.tsx
 * 와 같은 "···" 팝오버로 교체했다. "팔로잉 취소"는 이 카드의 대상(팔로워)이
 * 아니라 지금 보고 있는 뷰어 자신이 그 사람을 팔로우하고 있었다면 그 관계를
 * 끊는 액션이다(RelationshipButton.tsx의 언팔로우와 같은 엔드포인트).
 *
 * 🔒 후속(2026-08-27, /qa 코드 리뷰 발견 + 사용자 확인 — "실제로 팔로우중일때만
 * 버튼을 보여줘. 내 페이지에서는 팔로워 확인만 가능해야 할것 같은데? 제거는
 * 안돼게 하는게 맞지 않아?") — 처음엔 무조건 노출했는데, 뷰어가 그 사람을
 * 팔로우하지 않고 있으면 DELETE가 0건 삭제로 조용히 끝나 아무 반응 없는
 * 버튼처럼 보였다. 이제 `follower.isFollowedByViewer`가 true일 때만 노출한다
 * — 자기 프로필(`isSelf`)에서는 무조건 숨긴다(자기 팔로워는 확인만 가능,
 * 제거 불가가 맞다는 사용자 확인). isSelf가 아니어도 뷰어가 그 사람을
 * 안 팔로우하면 마찬가지로 숨는다(§10.2와 같은 원칙 — 의미 없는 액션은
 * 애초에 노출하지 않는다).
 */
function FollowerCard({ follower, index, isSelf }: { follower: FollowerListItem; index: number; isSelf: boolean }) {
  const router = useRouter();
  const [messaging, setMessaging] = useState(false);
  const [unfollowing, setUnfollowing] = useState(false);
  const [open, setOpen] = useState(false);

  async function onMessage() {
    if (messaging) return;
    setOpen(false);
    setMessaging(true);
    try {
      const res = await fetch('/api/messages/thread', { method: 'POST', body: JSON.stringify({ otherUserId: follower.id }) });
      if (!res.ok) return;
      const { threadId } = (await res.json()) as { threadId: string };
      router.push(`/messages?thread=${threadId}`);
    } finally {
      setMessaging(false);
    }
  }

  async function onUnfollow() {
    if (unfollowing) return;
    setOpen(false);
    setUnfollowing(true);
    try {
      await fetch('/api/follows', { method: 'DELETE', body: JSON.stringify({ followeeId: follower.id }) });
      router.refresh();
    } finally {
      setUnfollowing(false);
    }
  }

  return (
    <div className={styles.friendCard}>
      {/* 🔒 사용자 발견(2026-08-26, "아바타 아이콘 안나옴") — PostCard.tsx의
          authorAvatarUrl 패턴(실제 사진 있으면 img, 없으면 이니셜)을 그대로 옮겼다.
          이전엔 avatarUrl 자체가 안 내려와 색상 원만 비어 있었다. */}
      {follower.avatarUrl ? (
        <img src={follower.avatarUrl} alt="" className={styles.friendPhoto} />
      ) : (
        <span className={styles.friendPhoto} style={{ background: FRIEND_COLORS[index % FRIEND_COLORS.length] }} aria-hidden="true">
          {follower.nickname.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className={styles.friendInfo}>
        <a className={styles.friendName} href={`/@${follower.username}`}>
          {follower.nickname}
        </a>
        <span className={styles.friendMutual}>@{follower.username}</span>
      </div>
      <div className={styles.friendMenuWrap}>
        <button type="button" className={styles.friendMenuTrigger} onClick={() => setOpen((v) => !v)} aria-label="더보기">
          <DotsIcon />
        </button>
        {open && (
          <>
            <div className={styles.friendMenuOverlay} onClick={() => setOpen(false)} />
            <div className={styles.friendMenuPopover}>
              <button type="button" className={styles.friendMenuItem} onClick={onMessage} disabled={messaging}>
                <MessageIcon />
                메시지
              </button>
              {!isSelf && follower.isFollowedByViewer && (
                <button type="button" className={styles.friendMenuItem} onClick={onUnfollow} disabled={unfollowing}>
                  <UnfollowIcon />
                  팔로잉 취소
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 🔒 사용자 지시(2026-08, "replies탭의 리스트는 내가 작성한 댓글의 글리스트를
 * 보여줘야해(원글 + 내 댓글 그룹만 노출)") — 원글(`PostCard`, 다른 탭과 같은
 * 카드)을 그대로 보여주고, 그 아래에 이 사용자가 그 글에 직접 쓴 댓글들만
 * ("내 댓글 그룹", 다른 사람 댓글은 안 섞는다) 시간순으로 얹는다.
 *
 * 🔒 후속(2026-08, "댓글 부분 디자인을 글 내용보기 댓글 디자인을 적용해줘" →
 * "좋아요, 댓글 아이콘등이 빠졌어. 댓글 디자인을 똑같이 구현해야해") —
 * 각 댓글 항목을 CommentSection의 실제 댓글 아이템(아바타+메타줄+본문+
 * 액션 줄)과 같은 클래스로 그린다. `item.comments`는 전부 이 프로필
 * 주인(`profile*` props) 한 사람이 쓴 것이므로(`src/feed.ts`
 * `fetchPostsCommentedByUser`가 이미 그렇게 스코프한다) 댓글마다 작성자를
 * 따로 조회할 필요가 없다.
 *
 * 하트(좋아요)는 실제로 토글된다(§11.5.2 낙관적 토글 — CommentSection의
 * onToggleReaction과 같은 로직). 답글 아이콘은 CommentSection과 의미가
 * 다르다 — 이 탭은 서로 다른 여러 글에 걸친 과거 댓글 목록이라 그 자리에서
 * 바로 답글을 쓰는 인라인 폼은 새 구조가 필요해서(AskUserQuestion으로 확인)
 * "그 글의 댓글로 이동"(`{postHref}#comments`)으로 결정했다 — 클릭하면
 * 실제 포스트 상세의 댓글 영역으로 이동해 거기서 답글을 단다.
 */
function ReplyGroupCard({
  item,
  isLoggedIn,
  currentUserId,
  profileUsername,
  profileNickname,
  profileAvatarUrl,
}: {
  item: PostWithUserComments;
  isLoggedIn: boolean;
  currentUserId: string | null;
  profileUsername: string;
  profileNickname: string;
  profileAvatarUrl: string;
}) {
  const [comments, setComments] = useState<UserComment[]>(item.comments);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const postHref = item.post.categorySlug ? `/${item.post.categorySlug}/${item.post.publicId}` : `/post/${item.post.publicId}`;

  async function onToggleReaction(commentId: string) {
    if (!isLoggedIn || reactingId) return;
    const target = comments.find((c) => c.id === commentId);
    if (!target) return;
    const prevReaction = target.myReaction;
    const prevCount = target.reactionCount;
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, myReaction: !prevReaction, reactionCount: prevReaction ? c.reactionCount - 1 : c.reactionCount + 1 } : c)),
    );
    setReactingId(commentId);
    try {
      const res = await fetch(`/api/comments/${commentId}/reaction`, { method: 'POST' });
      if (!res.ok) throw new Error('failed');
    } catch {
      setComments((prev) => prev.map((c) => (c.id === commentId ? { ...c, myReaction: prevReaction, reactionCount: prevCount } : c)));
    } finally {
      setReactingId(null);
    }
  }

  return (
    <div className={styles.replyGroup}>
      {/* 🔒 사용자 발견(2026-09-06, HomeFeed.tsx와 같은 원인) — 프로필의
          Posts/Replies/Media 탭도 게시판 글이 카테고리 구분 없이 섞여
          나온다(§4.3 로그+게시판 병합) — 세 탭 전부 showCategoryBadge 추가. */}
      <PostCard post={item.post} isLoggedIn={isLoggedIn} currentUserId={currentUserId} showCategoryBadge />
      <div className={styles.replyComments}>
        {/* 🔒 사용자 발견(2026-08, "댓글 그룹에 아바타간 라인이 안보여") —
            CommentSection의 `.threadLine`(아바타 뒤로 지나가는 세로 연결선)을
            안 옮겨서 아바타가 여러 개 있어도 서로 이어지지 않았다.
            `.threadLine::after`는 `top:0`부터 `bottom:calc(-1 * var(--space-md))`
            까지 뻗어 자기 박스 다음 gap(--space-md)까지 닿는다 — .replyComments의
            gap도 정확히 --space-md라(위 참고) CommentSection의 .repliesList와
            같은 조건이 맞아떨어진다. CommentSection은 "부모 댓글 → 그 답글들"
            한 그룹에만 이 선을 그었지만, 여기선 한 PostCard 아래 나열된 이
            사용자의 댓글 전부가 하나의 시각적 그룹이라(실제 답글 관계가 아니어도)
            마지막 댓글 앞까지 전부 이어준다. */}
        {comments.map((c, i) => (
          <div
            key={c.id}
            className={i < comments.length - 1 ? `${commentStyles.comment} ${commentStyles.threadLine}` : commentStyles.comment}
          >
            {profileAvatarUrl ? (
              <img src={profileAvatarUrl} alt="" className={commentStyles.avatar} />
            ) : (
              <span className={commentStyles.avatar} aria-hidden="true">
                {profileUsername.trim().slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className={commentStyles.commentBody}>
              <div className={commentStyles.commentMeta}>
                <span className={commentStyles.commentAuthor}>{profileNickname}</span>
                <span className={commentStyles.commentTime}>{relativeTime(c.createdAt)}</span>
                {c.parentCommentId && <span className={commentStyles.authorBadge}>답글</span>}
              </div>
              <BodyContent body={c.body} textClassName={commentStyles.commentText} maxImages={1} compact />
              <div className={commentStyles.commentActions}>
                <button
                  type="button"
                  className={c.myReaction ? `${commentStyles.commentReactionBtn} ${commentStyles.commentReactionActive}` : commentStyles.commentReactionBtn}
                  onClick={() => onToggleReaction(c.id)}
                  disabled={!isLoggedIn}
                  aria-label="좋아요"
                  aria-pressed={c.myReaction}
                >
                  <ReactionIcon type="empathy" size={18} />
                  {c.reactionCount > 0 && <span>{c.reactionCount}</span>}
                </button>
                <a className={commentStyles.commentReplyBtn} href={`${postHref}#comments`} aria-label="그 글의 댓글로 이동">
                  <ReplyIcon />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 🔒 사용자 지시(2026-08, "profile페이지를... 목업UI와 완벽하게 싱크되어야해") —
 * artifact showProfile/showOtherProfile의 헤더 아래 4탭(Post/Replies/Media/
 * Friends) 바를 그대로 이식했다. artifact 자체는 Replies·Media를 장식용으로
 * 뒀지만(`isPostsTab = !isFriendsTab`, 세 탭 다 같은 글 목록) 이후 라운드에서
 * 실제 데이터로 채웠다 — Replies는 "이 사용자가 댓글을 쓴 글 + 그 댓글 그룹만"
 * (`src/feed.ts` `fetchPostsCommentedByUser`), Media는 "본문에 이미지·동영상이
 * 있는 글만"(`fetchMediaPostsForLog`, `link-detect.ts`의 기존 미디어 판별
 * 로직 재사용) — 둘 다 새 전용 쿼리다.
 *
 * 🔒 Follower 탭 콘텐츠는 `followersVisible`이 true일 때만 실제 목록을
 * 보여준다 — 원래 이 탭은 "Friends"였고(§11.7.1 Friends 페이지 최초 구현
 * 당시 "친구 목록은 본인만"을 프라이버시 기본값으로 확정), 사용자 지시
 * (2026-08-26, "프로필 페이지의 친구 탭을 folower로 변경하고, 내용도
 * follower들의 리스트를 보여줘")로 데이터 원본만 팔로워로 바뀌었다.
 *
 * 🔒 후속(2026-08-26, "팔로워 공개여부는 프로필 공개여부에 따라 가게") —
 * "본인만" 고정 정책을 걷어내고, `followersVisible`을 프로필 공개 설정
 * (user_logs.visibility: public/followers/friends/private)과 같은 기준으로
 * 계산하도록 UserLogView.tsx에서 바꿨다 — ProfileEditModal의 "프로필 공개"
 * 토글 하나가 로그 본문과 팔로워 목록을 함께 가른다. 탭 UI 자체는 타인
 * 프로필에도 뜨지만, 그 프로필의 공개 설정을 충족 못 하면 안내만 나온다.
 */
export function ProfileTabs({
  posts,
  repliedPosts,
  mediaPosts,
  followers,
  followersVisible,
  isSelf,
  isLoggedIn,
  currentUserId,
  emptyPostsLabel,
  profileUsername,
  profileNickname,
  profileAvatarUrl,
}: {
  posts: FeedPost[];
  repliedPosts: PostWithUserComments[];
  mediaPosts: FeedPost[];
  followers: FollowerListItem[];
  followersVisible: boolean;
  /** 🔒 사용자 확인(2026-08-27) — 자기 프로필의 팔로워 목록은 "확인만" 가능해야
   * 한다. FollowerCard의 "팔로잉 취소" 메뉴를 자기 프로필에서 숨기는 데 쓴다. */
  isSelf: boolean;
  isLoggedIn: boolean;
  currentUserId: string | null;
  emptyPostsLabel: string;
  /** 🔒 사용자 지시(2026-08, "replies의 댓글 부분 디자인을 글 내용보기
   * 댓글 디자인을 적용해줘") — Replies 탭 댓글 아이템의 아바타/닉네임에
   * 쓴다. repliedPosts의 모든 댓글은 이 프로필 주인 한 사람이 쓴 것이라
   * 댓글마다 따로 조회할 필요가 없다. */
  profileUsername: string;
  profileNickname: string;
  profileAvatarUrl: string;
}) {
  const [tab, setTab] = useState(0);

  return (
    <div>
      <div className={styles.tabBar}>
        {TAB_LABELS.map((label, i) => (
          <button key={label} type="button" className={i === tab ? styles.tabActive : styles.tab} onClick={() => setTab(i)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 3 ? (
        followersVisible ? (
          followers.length === 0 ? (
            <p className={styles.empty}>아직 팔로워가 없어요.</p>
          ) : (
            <div className={styles.friendsGrid}>
              {followers.map((f, i) => (
                <FollowerCard key={f.id} follower={f} index={i} isSelf={isSelf} />
              ))}
            </div>
          )
        ) : (
          <p className={styles.empty}>이 프로필의 공개 설정에 따라 팔로워 목록을 볼 수 없어요.</p>
        )
      ) : tab === 1 ? (
        repliedPosts.length === 0 ? (
          <p className={styles.empty}>아직 댓글을 쓴 글이 없어요.</p>
        ) : (
          <div className={styles.postsList}>
            {repliedPosts.map((item) => (
              <ReplyGroupCard
                key={item.post.id}
                item={item}
                isLoggedIn={isLoggedIn}
                currentUserId={currentUserId}
                profileUsername={profileUsername}
                profileNickname={profileNickname}
                profileAvatarUrl={profileAvatarUrl}
              />
            ))}
          </div>
        )
      ) : tab === 2 ? (
        mediaPosts.length === 0 ? (
          <p className={styles.empty}>아직 이미지·동영상이 있는 글이 없어요.</p>
        ) : (
          <div className={styles.postsList}>
            {mediaPosts.map((post) => (
              <PostCard key={post.id} post={post} isLoggedIn={isLoggedIn} currentUserId={currentUserId} showCategoryBadge />
            ))}
          </div>
        )
      ) : posts.length === 0 ? (
        <p className={styles.empty}>{emptyPostsLabel}</p>
      ) : (
        <div className={styles.postsList}>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} isLoggedIn={isLoggedIn} currentUserId={currentUserId} showCategoryBadge />
          ))}
        </div>
      )}
    </div>
  );
}
