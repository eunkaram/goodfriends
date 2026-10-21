import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { Gnb } from '../../../components/Gnb.tsx';
import { AuthorLink } from '../../../components/AuthorLink.tsx';
import { ReactionBar } from '../../../components/ReactionBar.tsx';
import { PostDetailMenu } from '../../../components/PostDetailMenu.tsx';
import { CommentSection } from '../../../components/CommentSection.tsx';
import { BodyContent } from '../../../components/BodyContent.tsx';
import { relativeTime } from '../../../components/relative-time.ts';
import { LeftSidebarLoggedIn, LeftSidebarLoggedOut, RightSidebar } from '../../../components/HomeSidebars.tsx';
import { ComposerModalProvider } from '../../../components/composer-modal-context.tsx';
import { SubscriptionsProvider } from '../../../components/subscriptions-context.tsx';
import { UnreadMessagesProvider } from '../../../components/unread-messages-context.tsx';
import { NewPostComposer } from '../../../components/NewPostComposer.tsx';
import { BackToListLink } from '../../../components/BackToListLink.tsx';
import { getSessionUserId } from '../../../lib/session.ts';
import { fetchPostWithComments } from '../../../lib/post-detail.ts';
import { fetchCategoryTreeAndPopular, fetchSubscribedCategories, type Category } from '../../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../../lib/popularity.ts';
import { fetchFollowing, type FollowingUser } from '../../../lib/relationships.ts';
import { hasUnreadMessages } from '../../../lib/messages.ts';
import { fetchAccountSummary } from '../../../lib/account.ts';
import { parseBodySegments, detectFirstLink, youtubeThumbnailUrl } from '../../../lib/link-detect.ts';
import { appBaseUrl } from '../../../lib/app-url.ts';
import styles from './page.module.css';

const META_EXCERPT_LENGTH = 155;

/** 이미지 마커·독립 링크 줄은 빼고 글 조각만 이어붙인 순수 텍스트(parseBodySegments 재사용, §11.7.4) — meta description과 JSON-LD 본문이 공유. */
function plainText(body: string): string {
  return parseBodySegments(body)
    .filter((seg) => seg.type === 'text')
    .map((seg) => seg.value)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plainTextExcerpt(body: string): string {
  const text = plainText(body);
  return text.length > META_EXCERPT_LENGTH ? `${text.slice(0, META_EXCERPT_LENGTH)}…` : text;
}

/** OG 카드용 이미지 — 별도 업로드 자산 없이 본문에 이미 있는 이미지/유튜브 썸네일을 재활용한다(PostCard.tsx previewHasImage와 같은 소스). */
function resolveOgImage(body: string): string | undefined {
  const imageSegment = parseBodySegments(body).find((seg) => seg.type === 'image');
  if (imageSegment && imageSegment.type === 'image') return imageSegment.url;
  const link = detectFirstLink(body);
  if (link?.isDirectImage) return link.url;
  if (link?.youtubeVideoId) return youtubeThumbnailUrl(link.youtubeVideoId);
  return undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string; publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const result = await fetchPostWithComments(publicId);
  if (!result) return {};
  const { post } = result;
  const canonicalPath = `/${post.categorySlug || 'post'}/${post.publicId}`;
  const description = plainTextExcerpt(post.body) || post.title;
  const ogImage = resolveOgImage(post.body);
  return {
    title: post.title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      // 🔒 Next.js는 openGraph 객체를 세그먼트별로 통째로 교체한다(필드 단위
      // 딥머지가 아님) — 여기서 siteName/locale을 다시 안 넣으면 루트
      // layout.tsx 기본값이 사라진다(실측 확인, curl로 <head> 비교).
      siteName: 'AI Community',
      locale: 'ko_KR',
      type: 'article',
      title: post.title,
      description,
      url: canonicalPath,
      publishedTime: post.createdAt,
      authors: [post.authorNickname],
      images: ogImage ? [ogImage] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: post.title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

/**
 * 포스트 상세 `/{category}/{publicId}` — §11.7.4. §11.9.1 1단계 "게이트 없이
 * 전문 노출" — 비로그인도 전체공개 글은 그대로 읽는다(§4.3). RLS가 posts에
 * 걸려 있어 조회 결과가 없으면(삭제·차단·비공개) 곧장 404로 보낸다 — 굳이
 * "권한 없음"과 "존재하지 않음"을 구분해 알려주지 않는다(§10.2 사유 비공개 원칙).
 *
 * 🔒 사용자 지시(2026-08) — "글 내용페이지도 리스트와 같은 레이아웃으로
 * 변경해줘. left, 중앙(글내용), right 레이아웃이야". §11.7.4 원안(단일 칼럼,
 * 우 사이드바 없음)을 뒤집고 카테고리 피드(`app/[category]/page.tsx`)와
 * 거의 같은 데이터 페칭·레이아웃을 쓴다 — 인기 글·신규 마켓 위젯의 인기순
 * 스코프는 이 글이 속한 카테고리로 맞췄다(카테고리 피드와 같은 논리).
 */
export default async function PostDetailPage({ params }: { params: Promise<{ category: string; publicId: string }> }) {
  const { category, publicId } = await params;

  const userId = await getSessionUserId();

  const result = await fetchPostWithComments(publicId);
  if (!result) notFound();
  const { post, comments } = result;

  // 🔒 사용자 지시(2026-08-21, "seo를 고려해야 할것 같아") — `[category]`
  // 세그먼트는 실제 접근 제어에 안 쓰인다(fetchPostDetail이 public_id만으로
  // 조회) — 그래서 어떤 문자열을 넣어도 같은 글이 그대로 열렸다. 검색엔진
  // 입장에서는 이게 같은 글에 대한 무한한 중복 URL이라 링크 자산이
  // 흩어진다. 여기서 정규(canonical) 세그먼트로 308 리다이렉트해 "글 하나 =
  // URL 하나"를 강제한다 — 로그 전용 글(카테고리 없음)의 정규 세그먼트는
  // PostCard.tsx 등 기존 폴백 링크와 같은 'post'.
  const canonicalCategory = post.categorySlug || 'post';
  if (category !== canonicalCategory) {
    permanentRedirect(`/${canonicalCategory}/${post.publicId}`);
  }

  // 🔒 성능 점검 발견(2026-08-22) — app/page.tsx·app/[category]/page.tsx와 같은
  // 이유로, 서로 결과를 참조하지 않는 조회들을 Promise.all로 묶었다. 위젯 실패
  // 격리(§11.5.0)는 각 프로미스 안의 try/catch로 그대로 유지한다.
  const [categoryTreeAndPopular, subscribed, account, following, popularPosts, unreadMessages] = await Promise.all([
    fetchCategoryTreeAndPopular(6), // 🔒 사용자 지시(2026-08-22) — 비로그인 좌 사이드바 6개
    userId ? fetchSubscribedCategories() : Promise.resolve<Pick<Category, 'id' | 'name' | 'slug'>[]>([]),
    userId ? fetchAccountSummary() : Promise.resolve(null),
    userId
      ? fetchFollowing(5).catch((err) => {
          console.error('following widget failed', err);
          return [] as FollowingUser[];
        })
      : Promise.resolve<FollowingUser[]>([]),
    fetchPopularPosts({ categoryId: post.categoryId ?? undefined, window: '24h', limit: 5 }).catch((err) => {
      console.error('popular posts widget failed', err); // 부분 실패 — 위젯만 조용히 제거(§11.5.0)
      return [] as PopularPost[];
    }),
    userId
      ? hasUnreadMessages().catch((err) => {
          console.error('unread messages check failed', err);
          return false;
        })
      : Promise.resolve(false),
  ]);

  // 🔒 실전 발견(2026-09-04) — 세션(Redis)은 유효한데 계정이 DB에서 지워진
  // 비정상 상태가 있을 수 있다(fetchAccountSummary가 그 경우 null을 준다) —
  // 그때는 로그인 안 한 것으로 취급한다.
  const isLoggedIn = account !== null;
  const currentUserId = isLoggedIn ? userId : null;
  const isOwner = currentUserId !== null && currentUserId === post.authorId;

  const { tree: categoryTree, popular: popularCategoriesForLoggedOut } = categoryTreeAndPopular;
  const currentUsername = account?.username;
  const currentNickname = account?.nickname;
  const currentAvatarUrl = account?.avatarUrl;

  const communityCategories = categoryTree.flatMap((g) => g.children.filter((c) => c.type === 'community'));

  // 🔒 사용자 지시(2026-09-06, "검색이나 ai답변에 잘 노출") — 구글 "포럼/토론"
  // 리치 결과 및 AI 크롤러가 우선 파싱하는 구조화 데이터(schema.org
  // DiscussionForumPosting). 삭제된 글엔 안 붙인다 — 모더레이터만 보는
  // 화면인데 검색엔진용 마크업을 실을 이유가 없다. `<` 이스케이프는 본문에
  // "</script>"가 그대로 들어있어도 스크립트 태그를 못 깨게 막는 표준 관행.
  const jsonLd = post.deletedAt
    ? null
    : {
        '@context': 'https://schema.org',
        '@type': 'DiscussionForumPosting',
        headline: post.title,
        text: plainText(post.body),
        url: `${appBaseUrl()}/${canonicalCategory}/${post.publicId}`,
        datePublished: post.createdAt,
        author: { '@type': 'Person', name: post.authorNickname },
        interactionStatistic: [
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: post.commentCount },
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: post.reactionCount },
        ],
        comment: comments.map((c) => ({
          '@type': 'Comment',
          text: plainText(c.body),
          dateCreated: c.createdAt,
          author: { '@type': 'Person', name: c.authorNickname },
        })),
      };

  const gnbCategoryTree = categoryTree.map((g) => ({
    name: g.name,
    children: g.children.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
  }));

  const leftSidebar = isLoggedIn ? (
    <LeftSidebarLoggedIn
      username={currentUsername ?? ''}
      nickname={currentNickname ?? currentUsername ?? ''}
      avatarUrl={currentAvatarUrl ?? ''}
      activeCategorySlug={post.categorySlug}
      following={following}
      categoryTree={gnbCategoryTree}
    />
  ) : (
    <LeftSidebarLoggedOut popularCategories={popularCategoriesForLoggedOut} categoryTree={gnbCategoryTree} />
  );

  return (
    <ComposerModalProvider>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <UnreadMessagesProvider initialHasUnread={unreadMessages}>
      <SubscriptionsProvider initialSubscribed={subscribed}>
        <Gnb
          sidebar={leftSidebar}
          profileHref={isLoggedIn ? `/@${currentUsername}` : '/signin'}
          categoryTree={gnbCategoryTree}
          isLoggedIn={isLoggedIn}
        />
        <NewPostComposer
          isLoggedIn={isLoggedIn}
          categories={communityCategories}
          defaultCategoryId={post.categoryId ?? undefined}
          authorId={currentUserId ?? ''}
          authorUsername={currentUsername ?? ''}
          authorNickname={currentNickname ?? currentUsername ?? ''}
          authorAvatarUrl={currentAvatarUrl}
        />
        <div className={styles.layout}>
          <aside className={styles.left}>{leftSidebar}</aside>

          <main className={styles.center}>
            {/* 🔒 사용자 지시(2026-08, "목업 CSS를 무조건 따라가야해") — artifact
                `showDetail` 실측(디코딩 원본 line 390-392): 다단계 Breadcrumb가
                아니라 "Home › 카테고리" 한 줄 텍스트 + 오른쪽 "← 목록으로"
                버튼이다. 카테고리가 없는 글(로그 전용)은 "Home"만 표시한다.
                🔒 사용자 발견(2026-08, "프로파일 -> 글 내용 -> 목록으로
                가기하면 home으로 이동 되어버리네... 어떤 위치든지 글
                읽기에서 목록으로 가기 하면 원래위치로 가야 할것 같아") —
                "← 목록으로" 버튼은 이제 브라우저 히스토리로 돌아간다(직접
                링크로 들어와 히스토리가 없을 때만 카테고리/홈으로 대체 —
                BackToListLink 참고). */}
            <div className={styles.topRow}>
              <div className={styles.listTitle}>
                <a href="/">Home</a>
                {post.categoryName && (
                  <>
                    <span className={styles.listTitleSep}>›</span>
                    {post.categoryName}
                  </>
                )}
              </div>
              <BackToListLink className={styles.backButton} fallbackHref={post.categorySlug ? `/${post.categorySlug}` : '/'}>
                ← 목록으로
              </BackToListLink>
            </div>
            {/* 🔒 사용자 지시(2026-08) — "유저 아이콘이 커지고 아이콘 우측 상단에
                아이디, 글쓴시간만 표시. 아래쪽에는 제목을 표시. 아이콘의 높이에
                맞춰서 오른쪽의 글자들도 적절히 재배치". 이전 라운드의 액센트
                (크림슨) 톤 변경은 사용자가 레이아웃을 표시하려고 그린 빨간
                주석이었다("제목을 빨간색 글자로 바꾸라는게 아니고, 빨간색으로
                레이아웃을 표시한거야") — 색은 원래대로 되돌렸다. 카테고리는
                이 줄에서 뺐다(브레드크럼·좌 사이드바에 이미 나온다). */}
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                {/* 🔒 사용자 지시(2026-08) — "글 목록/글 상세의 작성자 아바타"도
                    실제 프로필 사진을 반영해야 한다. */}
                {post.authorAvatarUrl ? (
                  <img src={post.authorAvatarUrl} alt="" className={styles.avatar} />
                ) : (
                  <span className={styles.avatar} aria-hidden="true">
                    {post.authorNickname.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className={styles.headerText}>
                  {post.deletedAt && <span className={styles.deletedBadge}>삭제됨</span>}
                  {/* 🔒 M4 — 뉴스봇·다이제스트봇 글("AI 에디터"). PostCard와 같은
                      배지 — users.is_agent가 소스다. */}
                  {post.authorIsAgent && !post.deletedAt && <span className={styles.agentBadge}>AI 에디터</span>}
                  <div className={styles.meta}>
                    {/* 🔒 사용자 지시(2026-08, "아이디 부분을 붉은색으로 변경") —
                        PostCard와 같은 패턴으로 유저 로그 페이지 링크 추가.
                        🔒 후속(2026-08, "유저 아이디 대신 유저네임으로 변경해줘") —
                        표시 텍스트만 닉네임으로 바꿨다. 링크 목적지는 여전히
                        username 기반 라우트(/@{username})라 href는 그대로 둔다.
                        🔒 후속(2026-08-24, "닉네임 클릭시 얼럿 모달이 떠야해") —
                        비로그인은 이동 없이 로그인 모달만 뜨도록 `AuthorLink`로
                        교체(서버 컴포넌트라 클릭 인터셉트는 이 클라이언트
                        컴포넌트에 위임). */}
                    <AuthorLink
                      className={styles.authorLink}
                      username={post.authorUsername}
                      nickname={post.authorNickname}
                      isLoggedIn={isLoggedIn}
                    />
                    <span>·</span>
                    <span className={styles.metaTime}>{relativeTime(post.createdAt)}</span>
                    {/* M2 — 조회수(작성자 본인·24h dedup 정책은 백엔드) */}
                    <span>·</span>
                    <span className={styles.metaTime}>조회 {post.views}</span>
                  </div>
                  {/* M2 — 시리즈 헤더(개발 로그 연재). 라우트는 2차에서 /series/[id]
                      페이지로 승격되지만, 1차에선 시리즈 제목 배지로 연재 소속만 안다. */}
                  {post.series && !post.deletedAt && (
                    <div className={styles.seriesBadge}>📚 {post.series.title}</div>
                  )}
                  <h1 className={styles.title}>{post.title}</h1>
                </div>
              </div>
              {/* 🔒 사용자 지시(2026-08) — "글 내용보기의 3점 메뉴가 리스트처럼
                  제목있는 곳의 오른쪽으로 옮겨줘". 이전 라운드가 사용자의 "글
                  하단"이라는 표현을 문자 그대로 따라 반응 줄 옆에 뒀던 걸
                  PostCard의 헤더 우측 배치로 옮겼다 — artifact `showDetail`이
                  원래 의도했던 위치와도 결과적으로 일치한다. */}
              <div className={styles.headerRight}>
                <PostDetailMenu
                  postId={post.id}
                  isLoggedIn={isLoggedIn}
                  isOwner={isOwner}
                  editPost={
                    isOwner
                      ? { id: post.id, title: post.title, body: post.body, categoryId: post.categoryId, visibility: post.visibility }
                      : null
                  }
                  categories={communityCategories}
                  authorUsername={currentUsername ?? ''}
                  authorNickname={currentNickname ?? currentUsername ?? ''}
                  authorAvatarUrl={currentAvatarUrl}
                />
              </div>
            </div>
            {/* 🔒 사용자 지시(2026-08) — "긁어온 내용이 그대로 붙여져서 저장되어야해.
                이미지 링크와 이미지명도 보이면 안돼". 상세 페이지는 이미지 개수
                제한 없이(maxImages 안 줌) 본문에 있는 이미지를 전부 원래 자리
                근처에 그대로 보여준다.
                🔒 후속(2026-08, "본문 내용에 대해 padding-left를 20px로") —
                텍스트·이미지·링크 미리보기 카드를 전부 감싸는 래퍼에 적용,
                아래 .actions(아이콘 줄)는 형제라 영향 없음. */}
            <div className={styles.bodyContent}>
              <BodyContent body={post.body} textClassName={styles.body} fullWidth />
            </div>

            <div className={styles.actions}>
              {/* 🔒 사용자 발견(2026-08, /design-review) — "아래부분 아이콘을
                  하트모양(like)과 댓글수(말풍선모양)으로 줄였으면 좋겠어".
                  compact 모드 — 6개 반응 중 '공감'(하트)만 노출 + 댓글 수
                  링크. 목록 카드(PostCard)는 그대로 6개 전부 보여준다 —
                  이 프로퍼티는 상세 페이지에만 넘긴다. */}
              <ReactionBar
                postId={post.id}
                initialCount={post.reactionCount}
                isLoggedIn={isLoggedIn}
                initialSelected={post.myReaction}
                iconSize={18}
                compact
                commentCount={post.commentCount}
              />
            </div>

            <div id="comments">
              <CommentSection
                postId={post.id}
                initialComments={comments}
                isLoggedIn={isLoggedIn}
                postAuthorUsername={post.authorUsername}
                currentUserId={currentUserId}
                currentUserAvatarUrl={currentAvatarUrl}
                currentUsername={currentUsername}
                currentNickname={currentNickname}
                postPublicId={post.publicId}
                isQna={post.categorySlug === 'qna'}
                isPostOwner={isOwner}
                adoptedCommentId={post.adoptedCommentId}
              />
            </div>
          </main>

          <aside className={styles.right}>
            <RightSidebar popularPosts={popularPosts} />
          </aside>
        </div>
      </SubscriptionsProvider>
      </UnreadMessagesProvider>
    </ComposerModalProvider>
  );
}
