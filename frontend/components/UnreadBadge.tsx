import styles from './UnreadBadge.module.css';

/** 안 읽음 표시 — 좌측 메뉴 "Messages" 옆과 메시지함 목록의 보낸사람 옆,
 * 두 곳에서 완전히 같은 모양을 써야 해서 컴포넌트 하나로 공유한다. */
export function UnreadBadge() {
  return (
    <span className={styles.badge} aria-hidden="true">
      NEW
    </span>
  );
}
