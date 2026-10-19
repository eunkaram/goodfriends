import { AdminAnnouncements } from '../../../components/AdminAnnouncements.tsx';
import styles from '../admin.module.css';

export default function AdminAnnouncementsPage() {
  return (
    <>
      <h1 className={styles.pageTitle}>Announcements</h1>
      <AdminAnnouncements />
    </>
  );
}
