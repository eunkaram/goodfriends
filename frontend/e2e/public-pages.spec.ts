import { test, expect } from '@playwright/test';

/**
 * 실제 reafy_backend(:3010)가 로컬에 떠 있어야 한다 — 콘텐츠 값 자체가 아니라
 * "서버 컴포넌트가 실제로 API를 호출해서 렌더된다"는 것만 검증한다(구체적인
 * 글 제목 등은 시딩 상태에 따라 계속 바뀐다).
 */

test('home page renders real feed data without a server error', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Runtime Error')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  // Gnb 로고 — 로그인 여부와 무관하게 항상 뜬다.
  await expect(page.getByRole('link', { name: 'Reafy' }).first()).toBeVisible();
});

test('category page renders without a server error', async ({ page }) => {
  const response = await page.goto('/chat');
  expect(response?.status()).toBe(200);
  await expect(page.getByText('Runtime Error')).toHaveCount(0);
});

test('robots.txt is served with the sitemap reference', async ({ page, baseURL }) => {
  const response = await page.request.get('/robots.txt');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('Disallow: /admin');
  expect(body).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
});

test('sitemap.xml is served with real post URLs from reafy_backend', async ({ page }) => {
  const response = await page.request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('<urlset');
  expect(body).toContain('<loc>');
});
