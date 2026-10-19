/**
 * M2 — /search: 우측 "전체검색" 폼에서 오는 공개 글 검색 페이지.
 * 서버에서 /api/posts/search(§6.8 bigm prefix 계약)를 그대로 태운다.
 */
import { Gnb } from '../../components/Gnb.tsx';
import { LeftSidebarLoggedOut, RightSidebar } from '../../components/HomeSidebars.tsx';
import { fetchPostSearch } from '../../lib/feed.ts';
import { fetchPublicCategoryTree } from '../../lib/categories.ts';
import { fetchPopularPosts, type PopularPost } from '../../lib/popularity.ts';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  const [posts, treeAndPopular, popularPosts] = await Promise.all([
    query
      ? fetchPostSearch(query, 50, 0).catch((err) => {
          console.error('search failed', err);
          return [];
        })
      : Promise.resolve([]),
    fetchPublicCategoryTree().catch(() => ({ tree: [], popular: [] })),
    fetchPopularPosts({ window: '24h', limit: 5 }).catch(() => [] as PopularPost[]),
  ]);

  return (
    <>
      <Gnb
        sidebar={<LeftSidebarLoggedOut popularCategories={treeAndPopular.popular} categoryTree={treeAndPopular.tree} />}
        profileHref="/signin"
        categoryTree={treeAndPopular.tree}
        isLoggedIn={false}
      />
      <div className={styles.layout}>
        <aside className={styles.left}>
          <LeftSidebarLoggedOut popularCategories={treeAndPopular.popular} categoryTree={treeAndPopular.tree} />
        </aside>
        <main className={styles.center}>
          <h1 className={styles.heading}>{query ? `“${query}” 검색 결과` : '전체검색'}</h1>
          {!query ? (
            <p className={styles.guidance}>글 제목·본문으로 시작하는 단어를 검색해 보세요.</p>
          ) : posts.length === 0 ? (
            <p className={styles.empty}>일치하는 공개 글이 없어요.</p>
          ) : (
            <ul className={styles.resultList}>
              {posts.map((p) => (
                <li key={p.id} className={styles.resultItem}>
                  <a className={styles.resultTitle} href={p.categorySlug ? `/${p.categorySlug}/${p.publicId}` : `/post/${p.publicId}`}>
                    {p.title}
                  </a>
                  <div className={styles.resultMeta}>
                    <span>{p.authorNickname}</span>
                    <span>·</span>
                    <span>{p.categoryName || '자유로그'}</span>
                    <span>·</span>
                    <span>공감 {p.reactionCount}</span>
                    <span>·</span>
                    <span>댓글 {p.commentCount}</span>
                  </div>
                  {p.bodyPreview && <p className={styles.resultBody}>{p.bodyPreview}</p>}
                </li>
              ))}
            </ul>
          )}
        </main>
        <aside className={styles.right}>
          <RightSidebar popularPosts={popularPosts} />
        </aside>
      </div>
    </>
  );
}
