/**
 * 이슈 #6 — app/sitemap.ts(Next.js 프레임워크 컨벤션, web 소관)가
 * "프론트는 DB 직접 접근 없음" 원칙의 유일한 예외로 raw SQL을 날리던 것을
 * 감싼 라우트. 공개 GET, 인증 불필요(§4.5 커뮤니티 글은 전체공개 고정) —
 * 불변식 1(Set-Cookie 금지)을 지켜서 Cache-Control: public을 CDN에 노출한다.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { appPool, withRelationCtx } from './db.ts';

const pool = appPool('exists');

export async function handleSitemapRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'GET' && url.pathname === '/api/sitemap-data') {
    const r = await withRelationCtx(pool, { userId: null }, (client) =>
      client.query<{ public_id: string; slug: string; created_at: string; updated_at: string }>(
        `SELECT p.public_id, c.slug, p.created_at, p.updated_at
         FROM posts p
         JOIN categories c ON c.id = p.category_id
         WHERE p.deleted_at IS NULL AND p.category_id IS NOT NULL
         ORDER BY p.created_at DESC
         LIMIT 5000`,
      ),
    );
    const entries = r.rows.map((row) => ({
      publicId: row.public_id,
      categorySlug: row.slug,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' });
    res.end(JSON.stringify({ entries }));
    return true;
  }

  return false;
}
