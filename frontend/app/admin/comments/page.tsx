import { AdminCommentSearch } from '../../../components/AdminCommentSearch.tsx';
import styles from '../admin.module.css';

export default function AdminCommentsPage() {
  return (
    <>
      <h1 className={styles.pageTitle}>댓글</h1>
      <AdminCommentSearch />
    </>
  );
}
