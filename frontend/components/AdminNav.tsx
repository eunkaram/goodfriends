'use client';

import { usePathname } from 'next/navigation';
import styles from '../app/admin/admin.module.css';

const NAV_ITEMS = [
  { href: '/admin', label: 'Users' },
  { href: '/admin/posts', label: 'Posts' },
  { href: '/admin/comments', label: 'Comments' },
  { href: '/admin/audit', label: 'Audit Logs' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/announcements', label: 'Announcements' },
  { href: '/admin/digests', label: 'Digests' },
];

/**
 * 좌측 사이드바 nav(사용자 지시, 2026-08-19 — "좌측은 메뉴... 기본
 * 레이아웃을 따라가면 돼"). 활성 표시는 HomeSidebars.module.css의
 * `.iconItem`/`.iconItemActive`와 같은 원칙 — accent는 배경 금지, 텍스트
 * 색+굵기만 바뀐다(§11.2.3). 현재 경로 판정에 `usePathname()`이 필요해
 * AdminLayout(서버 컴포넌트) 대신 이 파일만 클라이언트로 뺐다. `/admin`은
 * 정확히 일치할 때만 active — 안 그러면 다른 모든 `/admin/*` 하위 경로에서도
 * "Users"가 같이 켜진다(prefix 겹침).
 */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
        return (
          <a key={item.href} href={item.href} className={active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
