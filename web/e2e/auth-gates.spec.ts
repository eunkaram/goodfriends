import { test, expect } from '@playwright/test';

/**
 * §4.3 로그인 게이트 화면들 — 비로그인 방문 시 실제로 막히는지 확인한다.
 * 실제 backend(:3010)가 로컬에 떠 있어야 한다.
 */

test('saved page shows the login-required gate when logged out', async ({ page }) => {
  await page.goto('/saved');
  await expect(page.getByText('로그인이 필요')).toBeVisible();
});

test('posts page redirects to signin when logged out', async ({ page }) => {
  await page.goto('/posts');
  await expect(page).toHaveURL(/\/signin$/);
});

test('a private profile page shows the login-required gate when logged out', async ({ page }) => {
  await page.goto('/@seed');
  await expect(page.getByText('로그인이 필요')).toBeVisible();
});
