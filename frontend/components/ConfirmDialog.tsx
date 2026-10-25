'use client';

import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel: string;
  /** null이면 취소 버튼 없이 확인 버튼 하나만 뜨는 알림 모드. */
  cancelLabel?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  pendingLabel?: string;
  /** 파괴적 액션(삭제 등)이면 true(기본값) — 확인 버튼은 danger 외곽선만,
   *  취소 버튼이 accent로 채워진다. 알림성 "확인 후 실행"(친구 신청·팔로우
   *  등, PRD §11.9.2)이면 false — 확인 버튼이 accent로 채워진다. */
  destructive?: boolean;
}

/**
 * 🔒 공용컴포넌트(2026-08, "모든 버튼에서 두번 누르기 기능을 팝업으로
 * 대체하고 싶어" → "공용컴포넌트로 뽑아내줘") — PostCardMenu.tsx가 먼저
 * 만든 오버레이+카드 확인창(PostCard.module.css .deleteConfirm*)을 하나의
 * 공용 컴포넌트로 뽑았다. 오버레이(바깥) 클릭으로도 취소되지만 pending
 * 중엔 막는다(중복 취소/제출 방지) — 카드 자체는 stopPropagation으로
 * 클릭이 오버레이로 안 번지게 막는다.
 */
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  cancelLabel = '취소',
  onConfirm,
  onCancel,
  pending = false,
  pendingLabel,
  destructive = true,
}: ConfirmDialogProps) {
  if (!open) return null;

  const confirmBtn = (
    <button type="button" className={destructive ? styles.dangerBtn : styles.accentBtn} onClick={onConfirm} disabled={pending} autoFocus={!destructive}>
      {pending && pendingLabel ? pendingLabel : confirmLabel}
    </button>
  );
  const cancelBtn = cancelLabel !== null && (
    <button type="button" className={destructive ? styles.accentBtn : styles.outlineBtn} onClick={onCancel} disabled={pending} autoFocus={destructive}>
      {cancelLabel}
    </button>
  );

  return (
    <div className={styles.overlay} onClick={() => !pending && onCancel()}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <p className={styles.text}>{message}</p>
        <div className={styles.actions}>
          {destructive ? (
            <>
              {confirmBtn}
              {cancelBtn}
            </>
          ) : (
            <>
              {cancelBtn}
              {confirmBtn}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
