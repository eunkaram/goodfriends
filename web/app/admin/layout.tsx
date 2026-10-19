import { notFound } from 'next/navigation';
import { isActiveModerator } from '../../lib/admin.ts';
import { AdminNav } from '../../components/AdminNav.tsx';
import styles from './admin.module.css';

/**
 * `/admin/*` 공통 게이트 — 여기서 한 번만 `notFound()`를 부르면 하위
 * 페이지(유저/글/댓글/감사로그/신고) 전부에 적용된다(Next.js 레이아웃 상속).
 * `is_moderator`뿐 아니라 `is_banned`도 같이 확인한다 — 밴된 모더레이터도
 * 거부(사용자 지시, 2026-08 — "로그인 및 관리자 등급이상일때만 접근 가능,
 * 아닐경우 404 리턴을 기본으로"). 이 `notFound()`는 이 앱에 커스텀
 * not-found.tsx가 없어 Next.js 기본 404를 그대로 쓴다 — 다른 페이지의
 * `notFound()`(카테고리·프로필 등)와 바이트 단위로 동일한 응답이라
 * "이 라우트가 존재한다"는 신호 자체가 안 샌다.
 *
 * 🔒 사용자 지시(2026-08-19, "어드민 페이지 레이아웃을 2단(셀) 구성으로
 * 해줘. 좌측은 메뉴(상단에 로고, Users, Posts, Comments, Audit Logs,
 * Reports), 우측은 각 컨텐츠로... 기본 레이아웃을 따라가면 돼") — 전엔
 * 상단 가로 탭바 하나였다. "기본 레이아웃"은 공개 화면의 좌 사이드바+본문
 * 그리드(app/page.module.css `.layout`/`.left`/`.right`, pc 기준 사이드바
 * 고정폭+sticky)를 가리키는 것으로 해석 — 폭·간격 값을 그대로 재사용하되
 * 이 앱은 우측 위젯 칼럼이 없어 2단(사이드바+본문)만 둔다. 라벨은 영문으로
 * 확정(AskUserQuestion) — 이 화면은 관리자 전용 내부 도구라 사이트 나머지의
 * 한글 UI 관례(§9.3 등) 밖으로 명시적으로 뺀 것.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isActiveModerator())) notFound();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <a className={styles.logo} href="/admin" aria-label="Reafy Admin">
          Reafy <span className={styles.logoSub}>Admin</span>
        </a>
        <AdminNav />
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
