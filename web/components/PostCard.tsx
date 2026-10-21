import { ReactionBar } from './ReactionBar.tsx';
import { PostCardMenu } from './PostCardMenu.tsx';
import { AuthorLink } from './AuthorLink.tsx';
import { relativeTime } from './relative-time.ts';
import { BodyContent } from './BodyContent.tsx';
import { ClickableCardArea } from './ClickableCardArea.tsx';
import { detectFirstLink, parseBodySegments } from '../lib/link-detect.ts';
import type { FeedPost } from '../lib/feed.ts';
import styles from './PostCard.module.css';

export interface PostCardProps {
  post: FeedPost;
  isLoggedIn: boolean;
  /** §11.7.7 "저장한 글"에서 시작(artifact `showSaved` 실측) — 여러 카테고리가
   * 섞인 목록이라 각 카드에 소속 카테고리를 배지로 밝힌다. 카테고리 페이지처럼
   * breadcrumb·좌 사이드바로 이미 카테고리 맥락이 있는 화면만 안 넣는다.
   * 🔒 사용자 발견(2026-09-06, "홈화면 글 리스트에 카테고리가 안 보여") —
   * 홈·Posts(내 글)·프로필 탭도 여러 카테고리가 섞이는 건 똑같은데 빠져있었다
   * (breadcrumb가 "Home" 하나뿐이라 카테고리 맥락 자체가 없음) — 전부 추가. */
  showCategoryBadge?: boolean;
  /** §11.7.7 전용 — "···" 메뉴를 "저장" 대신 "저장 취소"로 바꾸고, 취소 시 이 카드를 목록에서 뺀다. */
  savedMode?: boolean;
  onUnsaved?: () => void;
  /** 사용자 지시(2026-08, "리스트에서 내글인데 3점 메뉴를 클릭하면 삭제하기
   * 메뉴가 없어") — 현재 로그인한 사용자의 id. post.authorId와 비교해 본인
   * 글일 때만 "삭제하기" 메뉴를 노출한다. */
  currentUserId?: string | null;
  /** 삭제 성공 시 이 카드를 목록에서 빼는 콜백 — 없으면 PostCardMenu가 대신 router.refresh()로 갱신한다. */
  onDeleted?: () => void;
}

/**
 * §11.7.0 공통 반복 컴포넌트. 요소 우선순위: 제목(1) → 본문 미리보기·반응/댓글수(2)
 * → 작성자·카테고리·시각(3). 공개범위 배지는 넣지 않는다 — 커뮤니티 글은 §5.2로
 * 늘 전체공개라 값이 하나뿐인 배지는 정보가 아니라 잡음이다.
 */
/**
 * 🔒 사용자 지시(2026-08) — "유저 아이콘이 커지고 아이콘 우측 상단에 아이디,
 * 글쓴시간만 표시. 아래쪽에는 제목을 표시. 아이콘의 높이에 맞춰서 오른쪽의
 * 글자들도 적절히 재배치". 아바타를 키우고 그 옆에 메타(아이디·시각)+제목을
 * 세로로 쌓은 텍스트 블록을 둔다 — 카테고리는 이 줄에서 뺐다(브레드크럼·좌
 * 사이드바에 이미 나온다). bodyPreview(최대 300자) 안에서만 링크를 찾는다,
 * 카드 자체가 미리보기 영역이라서. 여러 이미지가 있어도 카드는 레이아웃
 * 안정성을 위해 첫 장만(maxImages=1).
 */
export function PostCard({ post, isLoggedIn, showCategoryBadge, savedMode, onUnsaved, currentUserId, onDeleted }: PostCardProps) {
  const href = post.categorySlug ? `/${post.categorySlug}/${post.publicId}` : `/post/${post.publicId}`;
  const isOwner = currentUserId != null && currentUserId === post.authorId;
  // 🔒 사용자 지시(2026-08) — "리스트에서 글하나의 높이가 너무 커져서 ux가
  // 깨지는것 같아. 최대높이를 설정하고 그 높이보다 클경우 아래쪽에 배경색으로
  // 페이드 아웃되게해줘". 세로로 아주 긴 이미지 한 장이 카드 전체 높이를
  // 끌어올리는 게 원인이라(2줄 클램프된 텍스트는 이미 높이가 고정돼 있다)
  // 이미지가 있는 카드만 감싸서 최대높이+페이드를 적용한다 — 텍스트만
  // 있는 카드까지 감싸면 잘릴 게 없는데도 페이드가 떠 어색해진다.
  // 🔒 후속(2026-08, "글, 영상, 글, 미디어, 영상" 다중 미디어 인터리브 지원) —
  // parseBodySegments가 이미지 마커뿐 아니라 "줄 전체가 URL인" 영상/링크
  // 줄도 독립 세그먼트로 잡아준다 — 이런 미디어도 이미지와 똑같이 세로로
  // 커질 수 있어 캡 대상에 포함한다. 문장 중간에 낀 레거시 링크(세그먼트가
  // 하나도 안 잡히는 경우)만 기존처럼 isDirectImage 여부로 따로 판정한다.
  const previewSegments = post.bodyPreview ? parseBodySegments(post.bodyPreview) : [];
  const previewHasImage = post.bodyPreview
    ? previewSegments.some((s) => s.type !== 'text') || (detectFirstLink(post.bodyPreview)?.isDirectImage ?? false)
    : false;
  const preview = post.bodyPreview && <BodyContent body={post.bodyPreview} textClassName={styles.preview} maxImages={1} compact />;

  return (
    <article className={styles.card}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          {/* 🔒 Claude Design 확정안(2026-08) — artifact 실측: 이니셜 아바타(사진
              업로드 기능이 없어 noPhoto 상태만 씀), 42px, #dee0e1+이니셜.
              🔒 후속(2026-08, "글 목록/글 상세의 작성자 아바타"도 실제 사진을
              반영해야 한다) — authorAvatarUrl이 있으면 실제 사진을 그린다. */}
          {post.authorAvatarUrl ? (
            <img src={post.authorAvatarUrl} alt="" className={styles.avatar} />
          ) : (
            <span className={styles.avatar} aria-hidden="true">
              {post.authorNickname.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className={styles.headerText}>
            {/* 🔒 사용자 지시(2026-09-06, "삭제된 글이면... 글 리스트/글 보기
                페이지 모두 삭제된 글이라고 표시") — 글 상세(page.module.css
                .deletedBadge)와 같은 배지. 이게 보인다는 것 자체가 보는 사람이
                모더레이터라는 뜻이다(일반 유저는 RLS가 이 행 자체를 안 준다). */}
            {post.deletedAt && <span className={styles.deletedBadge}>삭제됨</span>}
            {/* 🔒 M4 — 뉴스봇·다이제스트봇 글("AI 에디터"). users.is_agent가
                소스라 만든 사이트에서만 참이다. */}
            {post.authorIsAgent && !post.deletedAt && <span className={styles.agentBadge}>AI 에디터</span>}
            <div className={styles.meta}>
              {/* 🔒 사용자 지시(2026-08) — "아이디를 클릭할수 있어야해. 링크는
                  유저로그페이지로 이동해야해". 🔒 후속(2026-08, "모든 글
                  리스트에도 아이디대신 유저네임으로") — 표시 텍스트만
                  닉네임으로, href는 여전히 username 기반 라우트. 🔒 후속
                  (2026-08-24, "닉네임 클릭시 얼럿 모달이 떠야해") — 비로그인은
                  이동 없이 로그인 모달만 뜨도록 `AuthorLink`로 교체. */}
              <AuthorLink
                className={styles.authorLink}
                username={post.authorUsername}
                nickname={post.authorNickname}
                isLoggedIn={isLoggedIn}
              />
              <span className={styles.metaSep}>·</span>
              <span className={styles.metaTime}>{relativeTime(post.createdAt)}</span>
            </div>
            <a className={styles.title} href={href}>
              {post.title}
            </a>
          </div>
        </div>
        {/* 🔒 사용자 지시(2026-08) — "게시판 카테고리 아이콘영역을 오른쪽 3점
            메뉴 좌측 옆으로 옮겨줘". 메타 줄(작성자·시각)에서 빼서 "···" 메뉴와
            같은 우측 그룹으로 옮겼다 — PostCardMenu 자신의 .menuWrap이 이미
            position:relative를 갖고 있어 팝오버 위치(top/right 기준)는 이
            래퍼 안에 있어도 그대로 정확하다. */}
        <div className={styles.headerRight}>
          {showCategoryBadge && post.categoryName && <span className={styles.categoryBadge}>{post.categoryName}</span>}
          <PostCardMenu
            postUrl={href}
            postId={post.id}
            isLoggedIn={isLoggedIn}
            savedMode={savedMode}
            onUnsaved={onUnsaved}
            isOwner={isOwner}
            onDeleted={onDeleted}
          />
        </div>
      </div>
      {/* 🔒 사용자 지시(2026-08, "리스트에서 내용을 클릭해도 글 보기 페이지로
          이동하게 만들어줘") — 본문 미리보기(텍스트·이미지·유튜브/영상
          썸네일) 영역을 감싸 클릭 시 상세로 이동한다. 제목(.title)은
          이미 별도 링크라 그대로 두고, 이 영역만 새로 클릭 가능해졌다. */}
      {/* 🔒 사용자 지시(2026-08, "모든 글 리스트, 글 내용보기에서 본문 내용에
          대해 padding-left를 20px로 설정해줘. 아래 아이콘과 나머지 영역은
          손대지마") — 텍스트뿐 아니라 이미지·링크 미리보기 카드까지 전부
          이 래퍼 하나로 감싸져 있어, 여기 한 곳만 고치면 본문 콘텐츠
          종류와 무관하게 일관되게 들여써진다. 아이콘 줄(.footer)은 이
          래퍼 밖의 형제라 영향 없음. */}
      <ClickableCardArea href={href} className={styles.bodyContent}>
        {previewHasImage ? (
          <div className={styles.previewCap}>
            {preview}
            <div className={styles.previewFade} aria-hidden="true" />
          </div>
        ) : (
          preview
        )}
      </ClickableCardArea>

      {/* 🔒 사용자 지시(2026-08) — "글 리스트의 하트 아이콘부분 -> 글내용보기
          페이지 처럼 여기도 하트와 댓글(말풍선)만 보이게 정리해줘. 오른쪽
          댓글 표시도 지워줘". 6개 반응 아이콘 + 별도 "댓글 N" 텍스트였던
          것을 포스트 상세와 같은 compact 바(하트+댓글수 pill 2개)로
          통일했다 — 댓글 그룹이 이미 카운트를 포함해서 오른쪽의 별도
          텍스트는 중복이라 제거. */}
      <div className={styles.footer}>
        <ReactionBar
          postId={post.id}
          initialCount={post.reactionCount}
          isLoggedIn={isLoggedIn}
          compact
          commentCount={post.commentCount}
          commentHref={`${href}#comments`}
        />
      </div>
    </article>
  );
}
