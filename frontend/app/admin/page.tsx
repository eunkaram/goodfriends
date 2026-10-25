import { AdminUserSearch } from '../../components/AdminUserSearch.tsx';
import styles from './admin.module.css';

export default function AdminUsersPage() {
  return (
    <>
      <h1 className={styles.pageTitle}>유저</h1>
      <AdminUserSearch />
    </>
  );
}
