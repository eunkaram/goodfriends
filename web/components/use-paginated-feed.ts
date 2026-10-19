/**
 * HomeFeed/CategoryFeed/MarketFeed가 각자 손으로 짰던 정렬 탭 + 더보기
 * 페이지네이션 로직 3중 복사 — 🔒 /review 발견(maintainability). 세 화면
 * 전부 "정렬 바뀌면 offset=0으로 재조회, 더보기는 현재 posts.length를
 * offset으로 이어붙이기" 패턴이 동일해서 하나로 추출했다.
 */
import { useEffect, useRef, useState } from 'react';

export const FEED_PAGE_SIZE = 20;

const COUNT_KEY_PREFIX = 'reafy_feed_count:';
const SCROLL_KEY_PREFIX = 'reafy_feed_scroll:';

/**
 * 🔒 사용자 발견(2026-08-26, "더보기 한번 하고 글보기 -> 목록으로 가기 하면
 * 첫 페이지로 이동돼. 원래 있던곳으로 이동을 시켜줘") — 이 앱은 전부 하드
 * 리로드라(BackToListLink/nav-history-boot.ts 참고) "더보기"로 늘어난
 * posts는 클라이언트 메모리에만 있고 뒤로가기 시 사라진다 — 서버는 첫
 * 페이지만 다시 그린다. Navigation Timing API의 type이 'back_forward'일
 * 때만(실제 뒤로/앞으로 가기로 도달했을 때만) 저장해둔 개수까지 다시
 * 불러오고 스크롤을 복원한다. 새 링크를 눌러 들어오거나 주소를 직접 친
 * 경우('navigate'/'reload')는 원래 첫 페이지부터 시작하는 게 맞다 —
 * 사용자가 요구한 건 "뒤로가기 때 원래 위치" 하나였다.
 *
 * 스크롤 위치는 브라우저의 기본 자동 복원(history.scrollRestoration)과
 * 별개로 직접 관리한다 — 이 값에 기대면 콘텐츠가 아직 짧을 때(더보기 복원
 * 전) 딱 한 번 시도하고 끝나버려 이 문제를 그대로 재현한다. pagehide(모든
 * 실제 페이지 이탈에서 안정적으로 발생 — beforeunload와 달리 bfcache를
 * 막지 않는다)에서 직접 스크롤 Y를 sessionStorage에 적어두고, 더보기
 * 콘텐츠를 다 채운 뒤에 우리가 직접 그 값으로 스크롤한다(브라우저의 자체
 * 시도보다 항상 나중에 실행되므로 그 위에 그냥 덮어써진다 — scrollRestoration
 * 자체를 건드릴 필요가 없다. 이 설정은 세션 전체에 걸리는 값이라 잘못
 * 건드리면 이 훅을 안 쓰는 다른 페이지의 기존 정상 동작까지 깨질 수 있다).
 */
function isBackForwardNavigation(): boolean {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return false;
  const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return nav?.type === 'back_forward';
}

export function usePaginatedFeed<TPost, TSort extends string>(opts: {
  initialPosts: TPost[];
  initialSort: TSort;
  buildUrl: (sort: TSort, offset: number) => string;
}) {
  const [sort, setSort] = useState<TSort>(opts.initialSort);
  const [posts, setPosts] = useState(opts.initialPosts);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(opts.initialPosts.length >= FEED_PAGE_SIZE);
  const scrollRestoredRef = useRef(false);

  function persistCount(count: number) {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(COUNT_KEY_PREFIX + window.location.pathname, String(count));
  }

  function restoreScroll() {
    if (scrollRestoredRef.current || typeof window === 'undefined') return;
    scrollRestoredRef.current = true;
    const savedY = sessionStorage.getItem(SCROLL_KEY_PREFIX + window.location.pathname);
    if (!savedY) return;
    // 두 번의 rAF — 늘어난 posts가 실제로 DOM에 반영·페인트된 다음 프레임에 스크롤한다.
    requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, Number(savedY))));
  }

  async function changeSort(next: TSort) {
    if (next === sort) return;
    setSort(next);
    setLoading(true);
    try {
      const res = await fetch(opts.buildUrl(next, 0));
      const { posts: fresh } = (await res.json()) as { posts: TPost[] };
      setPosts(fresh);
      setHasMore(fresh.length >= FEED_PAGE_SIZE);
      persistCount(fresh.length);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    setLoading(true);
    try {
      const res = await fetch(opts.buildUrl(sort, posts.length));
      const { posts: more } = (await res.json()) as { posts: TPost[] };
      setPosts((prev) => {
        const next = [...prev, ...more];
        persistCount(next.length);
        return next;
      });
      setHasMore(more.length >= FEED_PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }

  /** back/forward로 돌아왔을 때만 저장된 개수까지 다시 불러온다. */
  async function restoreUpTo(target: number) {
    setLoading(true);
    try {
      let acc = opts.initialPosts;
      let lastBatchLen = acc.length;
      while (acc.length < target) {
        const res = await fetch(opts.buildUrl(opts.initialSort, acc.length));
        const { posts: more } = (await res.json()) as { posts: TPost[] };
        lastBatchLen = more.length;
        if (more.length === 0) break;
        acc = [...acc, ...more];
        if (more.length < FEED_PAGE_SIZE) break;
      }
      setPosts(acc);
      setHasMore(lastBatchLen >= FEED_PAGE_SIZE);
    } finally {
      setLoading(false);
      restoreScroll();
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPageHide = () => {
      sessionStorage.setItem(SCROLL_KEY_PREFIX + window.location.pathname, String(window.scrollY));
    };
    window.addEventListener('pagehide', onPageHide);

    if (isBackForwardNavigation()) {
      const savedCount = Number(sessionStorage.getItem(COUNT_KEY_PREFIX + window.location.pathname) ?? '0');
      if (savedCount > opts.initialPosts.length) {
        void restoreUpTo(savedCount);
      } else {
        restoreScroll();
      }
    }

    return () => window.removeEventListener('pagehide', onPageHide);
    // 페이지 로드당 한 번만 — 마운트 시점 판정이라 의존성 없음.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prependPost(post: TPost) {
    setPosts((prev) => [post, ...prev]);
  }

  /** §11.7.7 "저장 취소" 전용 — id로 골라 목록에서 뺀다(서버 재조회 없이 즉시 반영, §11.5.2와 같은 원칙). */
  function removePost(matches: (post: TPost) => boolean) {
    setPosts((prev) => prev.filter((p) => !matches(p)));
  }

  return { sort, changeSort, posts, prependPost, removePost, loading, hasMore, loadMore };
}
