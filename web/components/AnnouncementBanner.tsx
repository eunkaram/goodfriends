import type { Announcement } from '../lib/announcements.ts';
import styles from './AnnouncementBanner.module.css';

/** reafy_backend 이슈 #10 — 관리자가 작성한 활성 공지를 `/messages` 상단에 노출. 여러 개면 위에서부터 최신순으로 쌓는다. */
export function AnnouncementBanner({ announcements }: { announcements: Announcement[] }) {
  if (announcements.length === 0) return null;

  return (
    <div className={styles.list}>
      {announcements.map((a) => (
        <div key={a.id} className={styles.banner}>
          <div className={styles.title}>{a.title}</div>
          <div className={styles.body}>{a.body}</div>
        </div>
      ))}
    </div>
  );
}
