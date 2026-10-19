import { AdminDigests } from '../../../components/AdminDigests.tsx';
import styles from '../admin.module.css';

export default function AdminDigestsPage() {
  return (
    <>
      <h1 className={styles.pageTitle}>Digests</h1>
      <AdminDigests />
    </>
  );
}
