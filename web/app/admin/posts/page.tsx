import { AdminPostSearch } from '../../../components/AdminPostSearch.tsx';
import styles from '../admin.module.css';

export default function AdminPostsPage() {
  return (
    <>
      <h1 className={styles.pageTitle}>글</h1>
      <AdminPostSearch />
    </>
  );
}
