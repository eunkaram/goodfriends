'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
import { ProfileLinksEditor } from './ProfileLinksEditor.tsx';
import type { ProfileLink } from '../lib/user-log.ts';
import { stripNonAscii } from './input-filters.ts';
import styles from './ProfileEditModal.module.css';

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

// CommentSection.tsx의 이미지 첨부와 같은 허용 목록(media.ts ALLOWED_MIME과 일치).
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// src/user-log.ts의 USERNAME_RE와 동일 — 네트워크 왕복 전에 명백히 잘못된
// 형식은 클라이언트에서 먼저 걸러 불필요한 요청을 줄인다.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const USERNAME_CHECK_DEBOUNCE_MS = 400;

type UsernameCheckStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

// src/auth.ts의 EMAIL_RE와 동일 — 저장 전 명백히 잘못된 형식을 미리 걸러낸다.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailCheckStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'required';

// backend/src/user-log.ts PROFILE_STACK_GROUPS/MAX_INTERESTS/MAX_STACK_ITEMS_PER_GROUP/
// MAX_STACK_ITEM_LENGTH와 동일 — 저장 전 명백히 틀린 입력(그룹당 13번째 항목, 25자
// 넘는 항목 등)을 미리 막아 불필요한 요청을 줄인다. 최종 검증은 서버가 한다.
const PROFILE_STACK_GROUPS = ['모델', '도구', '장비'] as const;
const MAX_INTERESTS = 5;
// 🔒 사용자 지시(2026-10, "모델, 도구, 장비는 각각 최대 5개씩만") — 12 → 5.
const MAX_STACK_ITEMS_PER_GROUP = 5;
const MAX_STACK_ITEM_LENGTH = 24;

function CloseSmallIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h2.5l1.5-2h8l1.5 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}

/**
 * goodfriends-ui 프로필 편집 모달(CLAUDE.md 3. "지역·위치 정보는 어디에도
 * 넣지 않는다") — 디코딩 원본 line 1142-1253을 이식했다. 이전 크림슨 라운드엔
 * users.country/postal_code를 직접 편집하는 우편번호+국가 select 쌍이
 * 있었는데(§11.7.6 원안), goodfriends 시안엔 그 필드 자체가 없다 — 제품 규칙에
 * 따라 전부 들어냈다(백엔드 postal_code_index·`/api/profile/location-preview`는
 * 그대로 두고 호출만 멈춘다 — UI만 범위).
 *
 * 🔒 후속(2026-08, "링크... 여러개 입력 받고 싶어") — 고정 3필드(링크/
 * 인스타그램/트위터)를 `ProfileLinksEditor`(임의 개수, 즉시 저장되는 칩
 * 목록)로 교체했다.
 *
 * 🔒 후속(2026-08, "유저 아이디 부분을 이름옆에 위치 시키고, 아이디 있던
 * 부분에 이메일을 보여줘. 수정가능하면 좋을것 같아") — 아이디를 닉네임과
 * 한 줄로, 그 아래(예전 아이디 자리)에 이메일 입력을 새로 놓았다. 이메일은
 * users/user_logs가 아니라 auth_credentials(별도 풀·역할, src/auth.ts)에
 * 있어 저장도 별도 엔드포인트(PATCH /api/auth/email)로 나간다 — 나머지
 * 필드의 PATCH /api/profile과 완전히 분리된 트랜잭션이다.
 */
export function ProfileEditModal({
  nickname,
  username,
  intro,
  email,
  avatarUrl,
  links,
  onLinksChange,
  hasPassword,
  visibility,
  interests,
  stack,
  interestOptions,
  onClose,
  onSaved,
}: {
  nickname: string;
  username: string;
  intro: string;
  /** 🔒 소셜 전용 계정은 null일 수 있다(이메일 자체를 등록한 적 없음) — 그 경우 빈 값으로 시작해 새로 추가할 수 있다. */
  email: string | null;
  /** 🔒 이메일을 바꿀 때 비밀번호 재확인을 보여줄지(updateEmail 재인증, src/auth.ts) — 비밀번호가 없는 소셜 전용 계정이면 false. */
  hasPassword: boolean;
  avatarUrl: string;
  links: ProfileLink[];
  onLinksChange: (next: ProfileLink[]) => void;
  visibility: 'public' | 'followers' | 'private';
  /** goodfriends 우측 프로필 위젯(2026-10) — 선택된 카테고리 slug 최대 5개. */
  interests: string[];
  /** 같은 위젯 — 모델/도구/장비 3개 고정 그룹, 그룹별 자유 텍스트 목록. */
  stack: Record<string, string[]>;
  /** "관심 분야"로 고를 수 있는 카테고리 목록(News/Q&A/자유게시판 제외 8개) —
   * lib/category-group-colors.ts interestEligibleCategories(categoryTree)로 뽑는다. */
  interestOptions: { id: string; name: string; slug: string }[];
  onClose: () => void;
  onSaved: (next: { nickname: string; intro: string; username: string; avatarUrl: string }) => void;
}) {
  const [nicknameValue, setNicknameValue] = useState(nickname);
  const [usernameValue, setUsernameValue] = useState(username);
  const [emailValue, setEmailValue] = useState(email ?? '');
  // 🔒 보안 점검 발견(2026-08-22) — 이메일 변경은 계정 탈취 확대 경로라
  // (세션 탈취 → 이메일 변경 → 비밀번호 재설정) 비밀번호가 있는 계정은
  // 재확인을 요구한다(updateEmail, src/auth.ts). 소셜 전용 계정(hasPassword
  // false)은 확인할 비밀번호 자체가 없어 요구하지 않는다.
  const [emailPasswordValue, setEmailPasswordValue] = useState('');
  const [introValue, setIntroValue] = useState(intro);
  const [interestsValue, setInterestsValue] = useState(interests);
  const [stackValue, setStackValue] = useState(stack);
  // 🔒 디코딩 원본 line 1228 — 그룹별 "+ 추가" 입력창은 각자 독립된 draft 텍스트를
  // 갖는다(Enter로 커밋하면 그 칸만 비워진다, 다른 그룹 입력 중이던 텍스트는 안 건드림).
  const [stackDraft, setStackDraft] = useState<Record<string, string>>({});
  const [avatarUrlValue, setAvatarUrlValue] = useState(avatarUrl);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const [visibilityValue, setVisibilityValue] = useState(visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usernameCheck, setUsernameCheck] = useState<UsernameCheckStatus>('idle');
  const usernameCheckSeq = useRef(0);
  const [emailCheck, setEmailCheck] = useState<EmailCheckStatus>('idle');
  const emailCheckSeq = useRef(0);
  useModalOpenEffect(true);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 🔒 사용자 지시(2026-08, "아이디 변경시 비동기로 중복여부 확인해야해") —
  // 타이핑을 debounce해서 GET /api/profile/username-available을 부른다.
  // seq 카운터로 응답이 늦게 도착한 옛 요청(예: "ab"→"abc"→"abcd"로 빠르게
  // 바꿨을 때 "ab" 요청이 "abcd" 확인 후에 돌아오는 경우)을 무시한다 —
  // 그런 경우까지 반영하면 최신 입력값에 대한 상태가 옛 응답으로 덮인다.
  useEffect(() => {
    const trimmed = usernameValue.trim().toLowerCase();
    if (trimmed === username) {
      setUsernameCheck('idle'); // 원래 자기 아이디 그대로면 확인 자체가 무의미
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setUsernameCheck('invalid');
      return;
    }
    setUsernameCheck('checking');
    const seq = ++usernameCheckSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/username-available?username=${encodeURIComponent(trimmed)}`);
        if (usernameCheckSeq.current !== seq) return; // 이미 더 최신 입력값이 있음 — 이 응답은 버린다
        if (!res.ok) {
          setUsernameCheck('idle');
          return;
        }
        const { available } = (await res.json()) as { available: boolean };
        setUsernameCheck(available ? 'available' : 'taken');
      } catch {
        if (usernameCheckSeq.current === seq) setUsernameCheck('idle');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [usernameValue, username]);

  // 🔒 사용자 지시(2026-08, "아이디 있던 부분에 이메일을 보여줘. 수정가능
  // 하면 좋을것 같아") — 위 아이디 확인과 완전히 같은 debounce+seq 패턴.
  // 원래 이메일이 있었는데(email !== null) 빈 값으로 지우면 'required'로
  // 막는다 — 그 계정이 비밀번호 로그인 수단을 갖고 있었다면 이메일을 완전히
  // 비우는 순간 로그인 방법이 사라진다. 소셜 전용 계정(원래 null)은 안
  // 채운 채로 둬도 그만이라 빈 값이 허용된다.
  useEffect(() => {
    const trimmed = emailValue.trim().toLowerCase();
    if (trimmed === (email ?? '')) {
      setEmailCheck('idle'); // 원래 이메일 그대로면 확인 자체가 무의미
      return;
    }
    if (trimmed.length === 0) {
      setEmailCheck(email ? 'required' : 'idle');
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setEmailCheck('invalid');
      return;
    }
    setEmailCheck('checking');
    const seq = ++emailCheckSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/email-available?email=${encodeURIComponent(trimmed)}`);
        if (emailCheckSeq.current !== seq) return; // 이미 더 최신 입력값이 있음 — 이 응답은 버린다
        if (!res.ok) {
          setEmailCheck('idle');
          return;
        }
        const { available } = (await res.json()) as { available: boolean };
        setEmailCheck(available ? 'available' : 'taken');
      } catch {
        if (emailCheckSeq.current === seq) setEmailCheck('idle');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [emailValue, email]);

  // 🔒 사용자 지시(2026-08, "유저 아이콘... 클릭시 이미지 업로드 기능넣어줘") —
  // CommentSection.tsx의 이미지 첨부와 같은 업로드 라우트(POST /api/media/upload)를
  // 그대로 재사용한다. 아바타는 한 장만 필요해 그 파일의 다중 이미지 큐 구조
  // 없이 훨씬 단순하게 구현했다.
  async function onAvatarFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 골라도 onChange가 또 발생하도록
    if (!file) return;
    if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
      setError('이미지 파일(jpg·png·gif·webp)만 업로드할 수 있어요.');
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    setAvatarUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/media/upload', { method: 'POST', headers: { 'content-type': file.type }, body: file });
      if (!res.ok) throw new Error('failed');
      const { url } = (await res.json()) as { url: string };
      setAvatarUrlValue(url);
    } catch {
      setError('사진 업로드에 실패했어요.');
    } finally {
      setAvatarUploading(false);
      setAvatarPreview(null);
      URL.revokeObjectURL(preview);
    }
  }

  // 🔒 "확인 중"이거나 이미 사용 중/형식 오류로 판정된 아이디로는 저장 버튼
  // 자체를 막는다 — 어차피 서버(updateProfile)가 저장 시점에 다시 한번
  // 막아주지만, 뻔히 실패할 요청을 보내는 대신 미리 막는 게 낫다.
  const usernameBlocking = usernameCheck === 'taken' || usernameCheck === 'invalid' || usernameCheck === 'checking';
  const emailBlocking = emailCheck === 'taken' || emailCheck === 'invalid' || emailCheck === 'checking' || emailCheck === 'required';
  const emailChanged = emailValue.trim().toLowerCase() !== (email ?? '');
  const emailPasswordRequired = emailChanged && hasPassword;
  const emailPasswordBlocking = emailPasswordRequired && !emailPasswordValue;

  // 🔒 디코딩 원본 line 1728-1732 — 이미 선택된 항목은 눌러서 해제, 아니면
  // 추가(단, 5개 꽉 찼으면 추가 자체가 무시된다 — 에러를 안 띄우고 조용히
  // 막는 게 원본 동작).
  function toggleInterest(slug: string) {
    setInterestsValue((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= MAX_INTERESTS) return prev;
      return [...prev, slug];
    });
  }

  function addStackItem(group: string) {
    const value = (stackDraft[group] ?? '').trim();
    if (!value || value.length > MAX_STACK_ITEM_LENGTH) return;
    setStackValue((prev) => {
      const items = prev[group] ?? [];
      if (items.includes(value) || items.length >= MAX_STACK_ITEMS_PER_GROUP) return prev;
      return { ...prev, [group]: [...items, value] };
    });
    setStackDraft((prev) => ({ ...prev, [group]: '' }));
  }

  function removeStackItem(group: string, value: string) {
    setStackValue((prev) => ({ ...prev, [group]: (prev[group] ?? []).filter((v) => v !== value) }));
  }

  async function save() {
    if (!nicknameValue.trim() || saving || avatarUploading || usernameBlocking || emailBlocking || emailPasswordBlocking) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          nickname: nicknameValue.trim(),
          intro: introValue.trim(),
          visibility: visibilityValue,
          username: usernameValue.trim(),
          avatarUrl: avatarUrlValue.trim(),
          interests: interestsValue,
          stack: stackValue,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error === 'USERNAME_TAKEN'
            ? '이미 사용 중인 아이디예요.'
            : body?.error === 'INVALID_LOCATION'
              ? '우편번호가 선택한 국가와 맞지 않아요.'
              : body?.error === 'INVALID_INPUT'
                ? '입력값을 확인해주세요(아이디는 영소문자·숫자·밑줄 3~20자예요).'
                : '저장에 실패했어요.',
        );
        return;
      }

      // 🔒 이메일은 auth_credentials(별도 풀·역할)에 있어 위 /api/profile과
      // 완전히 다른 엔드포인트다 — 실제로 바뀌었을 때만 불러서 불필요한
      // 인증메일 재발송(레이트리밋 소모)을 피한다. 이 요청이 실패해도 위
      // 프로필 저장은 이미 반영된 상태라, onSaved/onClose를 안 불러 모달을
      // 열어둔 채 재시도할 수 있게 한다(닉네임 등을 중복 저장해도 무해하다).
      const trimmedEmail = emailValue.trim().toLowerCase();
      if (trimmedEmail !== (email ?? '')) {
        const emailRes = await fetch('/api/auth/email', {
          method: 'PATCH',
          body: JSON.stringify({ email: trimmedEmail, password: hasPassword ? emailPasswordValue : undefined }),
        });
        if (!emailRes.ok) {
          const body = await emailRes.json().catch(() => null);
          setError(
            body?.error === 'EMAIL_TAKEN'
              ? '이미 사용 중인 이메일이에요.'
              : body?.error === 'INVALID_CREDENTIAL'
                ? '비밀번호가 일치하지 않아요.'
                : '이메일 저장에 실패했어요.',
          );
          return;
        }
      }

      // 🔒 router.refresh()/이동 판단은 호출부(ProfileHeader.onSaved)에 맡긴다 —
      // 아이디가 바뀐 경우 refresh 대신 새 URL로 push해야 해서 여기서 미리
      // refresh를 부르면 그 직후 push와 경합한다(이메일도 같은 이유로 여기서
      // 로컬 상태를 안 만들고 서버 재조회에 맡긴다).
      onSaved({
        nickname: nicknameValue.trim(),
        intro: introValue.trim(),
        username: usernameValue.trim(),
        avatarUrl: avatarUrlValue.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 🔒 사용자 발견(2026-10, "오른쪽 스크롤바때문에 라운드처리가 안돼") —
            PostComposerModal의 카테고리 드롭다운과 같은 원인·같은 해법.
            `.modal`은 radius+overflow:hidden으로 모서리만 담당하고, 실제
            스크롤은 안쪽 `.modalScroll`로 옮긴다. */}
        <div className={styles.modalScroll}>
        <div className={styles.modalHeader}>
          <span className={styles.modalHeaderTitle}>프로필 편집</span>
        </div>

        <div className={styles.body}>
          {error && <p className={styles.fieldError}>{error}</p>}

          <div className={styles.avatarRow}>
            {/* 🔒 사용자 지시(2026-08, "사진변경 버튼은 제거, 대신 유저 아이콘
                오른쪽아래에 변경아이콘을 표시하고 유저아이콘을 클릭시 이미지
                업로드 기능넣어줘") — 별도 "사진 변경" 버튼을 없애고 아바타
                자체를 업로드 트리거로 만들었다. 미리보기(avatarPreview)는
                업로드 중에만 보이고, 성공하면 실제 원격 URL로 바뀐다. */}
            <button
              type="button"
              className={styles.avatarButton}
              onClick={() => avatarFileInputRef.current?.click()}
              disabled={avatarUploading}
              aria-label="프로필 사진 변경"
            >
              {avatarPreview || avatarUrlValue ? (
                <img src={avatarPreview ?? avatarUrlValue} alt="" className={styles.avatar} />
              ) : (
                <span className={styles.avatar} aria-hidden="true">
                  {initial(nicknameValue)}
                </span>
              )}
              <span className={styles.avatarEditBadge} aria-hidden="true">
                <CameraIcon />
              </span>
            </button>
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={onAvatarFileSelected}
              className={styles.avatarFileInput}
            />
            <div className={styles.avatarField}>
              {/* 🔒 사용자 지시(2026-08, "유저 아이디 부분을 이름옆에 위치
                  시키고, 아이디 있던 부분에 이메일을 보여줘") — 아이디를
                  독립된 아래 줄이 아니라 닉네임과 한 줄로 옮겼다. 좁은
                  화면에서는 .nameRow가 줄바꿈해서 아이디가 아래로 떨어진다
                  (고정 폭 대신 flex-basis라 강제로 안 찌그러진다). */}
              <div className={styles.nameRow}>
                <input
                  type="text"
                  value={nicknameValue}
                  onChange={(e) => setNicknameValue(e.target.value)}
                  aria-label="닉네임"
                  maxLength={30}
                  className={styles.nicknameInput}
                />
                {/* 🔒 사용자 지시(2026-08) — "사진 변경자리에 아이디 인풋폼을
                    위치시켜줘"(예전 라운드). 형식·중복 검증은 여전히 저장
                    시 서버가 한다. 메시지는 입력창 크기를 안 바꾸도록
                    .handleFieldCompact 안쪽에 절대위치로 겹쳐서 뜬다. */}
                <div className={styles.handleFieldCompact}>
                  <span className={styles.atPrefix}>@</span>
                  <input
                    id="profile-edit-username"
                    type="text"
                    value={usernameValue}
                    // 🔒 사용자 지시(2026-08, "아이디는 영문만 입력 가능하게해줘") —
                    // src/user-log.ts의 USERNAME_RE(영소문자·숫자·밑줄)와 같은
                    // 문자셋만 타이핑 즉시 남긴다 — 한글 등 IME로 잘못 들어온
                    // 문자를 저장 시점이 아니라 입력 시점에 걸러낸다.
                    onChange={(e) => setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    maxLength={20}
                    autoComplete="off"
                    aria-label="아이디"
                  />
                  {usernameCheck !== 'idle' && (
                    <span
                      className={`${styles.checkOverlay} ${usernameCheck === 'available' ? styles.checkOk : usernameCheck === 'checking' ? styles.checkNeutral : styles.checkBad}`}
                    >
                      {usernameCheck === 'checking' && '확인 중...'}
                      {usernameCheck === 'available' && '사용 가능한 아이디예요'}
                      {usernameCheck === 'taken' && '이미 사용 중인 아이디예요'}
                      {usernameCheck === 'invalid' && '형식 오류'}
                    </span>
                  )}
                </div>
              </div>
              {/* 🔒 사용자 지시(2026-08, "아이디 있던 부분에 이메일을 보여줘.
                  수정가능하면 좋을것 같아") — 아이디가 옮겨가며 비게 된 그
                  자리(예전엔 .handleFieldCompact가 있던 줄)에 이메일 입력을
                  놓았다. 소셜 전용 계정(email prop이 null)은 빈 값으로
                  시작해서 새로 추가할 수 있다. */}
              <div className={styles.emailFieldWrap}>
                <input
                  id="profile-edit-email"
                  type="email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(stripNonAscii(e.target.value))}
                  placeholder="이메일"
                  maxLength={254}
                  autoComplete="off"
                  aria-label="이메일"
                  className={styles.emailInput}
                />
                {emailCheck !== 'idle' && (
                  <span
                    className={`${styles.checkOverlay} ${emailCheck === 'available' ? styles.checkOk : emailCheck === 'checking' ? styles.checkNeutral : styles.checkBad}`}
                  >
                    {emailCheck === 'checking' && '확인 중...'}
                    {emailCheck === 'available' && '사용 가능한 이메일이에요'}
                    {emailCheck === 'taken' && '이미 사용 중인 이메일이에요'}
                    {emailCheck === 'invalid' && '형식 오류'}
                    {emailCheck === 'required' && '이메일은 비워둘 수 없어요'}
                  </span>
                )}
              </div>
              {emailChanged && !emailBlocking && <span className={styles.emailChangeHint}>저장하면 새 이메일로 인증 메일이 발송돼요.</span>}
              {/* 🔒 보안 점검 발견(2026-08-22) — 이메일 변경은 계정 탈취 확대
                  경로라(세션 탈취 → 이메일 변경 → 비밀번호 재설정) 비밀번호
                  재확인을 요구한다. 소셜 전용 계정(hasPassword false)은
                  확인할 비밀번호가 없어 이 필드 자체를 안 보여준다. */}
              {emailPasswordRequired && (
                <input
                  type="password"
                  value={emailPasswordValue}
                  onChange={(e) => setEmailPasswordValue(stripNonAscii(e.target.value))}
                  placeholder="이메일을 바꾸려면 현재 비밀번호를 입력하세요"
                  autoComplete="current-password"
                  aria-label="현재 비밀번호"
                  className={styles.emailInput}
                />
              )}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="profile-edit-intro">
              소개글
            </label>
            <textarea
              id="profile-edit-intro"
              rows={3}
              placeholder="자신을 소개해보세요"
              value={introValue}
              onChange={(e) => setIntroValue(e.target.value)}
              maxLength={300}
              className={styles.introTextarea}
            />
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>링크</span>
            <ProfileLinksEditor links={links} onLinksChange={onLinksChange} />
          </div>

          {/* 🔒 goodfriends 우측 프로필 위젯(2026-10, "오른쪽영역을 디자인
              시안대로") — 디코딩 원본 line 1203-1213: "관심 분야" 최대
              5개(interestOptions는 News/Q&A/자유게시판 뺀 8개 카테고리,
              lib/category-group-colors.ts interestEligibleCategories). */}
          <div className={styles.field}>
            <div className={styles.fieldLabelRow}>
              <span className={styles.fieldLabel}>관심 분야</span>
              <span className={styles.fieldHint}>최대 {MAX_INTERESTS}개</span>
            </div>
            <div className={styles.interestOptions}>
              {interestOptions.map((opt) => {
                const on = interestsValue.includes(opt.slug);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={on ? `${styles.interestChip} ${styles.interestChipActive}` : styles.interestChip}
                    onClick={() => toggleInterest(opt.slug)}
                  >
                    {opt.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 🔒 디코딩 원본 line 1215-1232 — "사용 중인 스택", 그룹 3개
              고정(모델/도구/장비), 그룹 안 항목은 Enter로 추가/×로 삭제하는
              자유 텍스트. */}
          <div className={styles.field}>
            <div className={styles.fieldLabelRow}>
              <span className={styles.fieldLabel}>사용 중인 스택</span>
              <span className={styles.fieldHint}>그룹당 최대 {MAX_STACK_ITEMS_PER_GROUP}개</span>
            </div>
            <div className={styles.stackGroups}>
              {PROFILE_STACK_GROUPS.map((group) => {
                const items = stackValue[group] ?? [];
                const atLimit = items.length >= MAX_STACK_ITEMS_PER_GROUP;
                return (
                  <div key={group} className={styles.stackGroupRow}>
                    <span className={styles.stackGroupLabel}>{group}</span>
                    <div className={styles.stackGroupItems}>
                      {items.map((item) => (
                        <span key={item} className={styles.stackChip}>
                          {item}
                          <button type="button" className={styles.stackChipRemove} aria-label={`${item} 삭제`} onClick={() => removeStackItem(group, item)}>
                            <CloseSmallIcon />
                          </button>
                        </span>
                      ))}
                      {/* 🔒 사용자 지시(2026-10, "모델, 도구, 장비는 각각 최대 5개씩만") —
                          addStackItem()도 이 상한을 다시 막지만(이중 방어),
                          꽉 찬 그룹은 입력창 자체를 숨겨 더 못 넣는다는 걸
                          바로 보여준다(관심 분야 칩이 5개에서 멈추는 것과 같은
                          원칙, 다만 자유 텍스트라 토글이 아니라 입력창 숨김으로). */}
                      {!atLimit && (
                        <input
                          type="text"
                          aria-label={`${group} 추가`}
                          placeholder="+ 추가"
                          value={stackDraft[group] ?? ''}
                          maxLength={MAX_STACK_ITEM_LENGTH}
                          onChange={(e) => setStackDraft((prev) => ({ ...prev, [group]: e.target.value }))}
                          onKeyDown={(e) => {
                            // 🔒 사용자 발견(2026-10, "모델을 하나 추가 했는데 두개가
                            // 들어가") — 한글 등 조합형 입력 중 Enter로 글자를
                            // 조합 확정하면 브라우저가 먼저 isComposing:true인
                            // keydown(Enter)을 쏘고, 조합이 끝난 뒤 같은 물리
                            // 키 입력을 isComposing:false인 keydown(Enter)으로
                            // 한 번 더 쏘는 브라우저가 있다(Chrome/Safari 둘 다
                            // 재현됨) — 가드 없이는 같은 글자가 두 번 addStackItem을
                            // 태운다. 조합 중(isComposing) 이벤트는 무시하고,
                            // 조합이 끝난 "진짜" Enter에서만 추가한다.
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              addStackItem(group);
                            }
                          }}
                          className={styles.stackAddInput}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 🔒 사용자 지시(2026-08, "프로필 수정에서 프로필 공개를
              비공개/follower/공개 로 토글버튼으로 수정해줘") — 켜짐/꺼짐
              스위치(공개↔비공개 2단계)로는 팔로워 공개를 표현할 수 없어서
              3단 세그먼트 컨트롤로 교체했다. 새 글쓰기 팝업의 게시판/My
              Post 세그먼트(components/HomeFeed.module.css)와 같은 시각
              언어(회색 트랙, 활성만 흰 배경+box-shadow+액센트 글자,
              §11.2.3처럼 배경을 액센트로 채우지 않음)를 그대로 재사용한다.

              🔒 후속(2026-08-26, "팔로워 공개여부는 프로필 공개여부에 따라
              가게") — 이 설정이 이제 로그 본문뿐 아니라 프로필 페이지의
              팔로워 목록 탭도 같이 가른다(app/[category]/UserLogView.tsx
              followersVisible). 별도 토글을 추가하지 않고 안내 문구에
              "팔로워 목록"을 덧붙이는 것으로 반영했다. */}
          <div className={styles.privacyRow}>
            <div>
              <div className={styles.privacyLabel}>프로필 공개</div>
              <div className={styles.privacyHint}>
                {visibilityValue === 'private'
                  ? '비공개로 설정하면 나만 내 로그와 팔로워 목록을 볼 수 있어요.'
                  : visibilityValue === 'followers'
                    ? '나를 팔로우하는 사람만 내 로그와 팔로워 목록을 볼 수 있어요.'
                    : '누구나 내 로그와 팔로워 목록을 볼 수 있어요.'}
              </div>
            </div>
            <div className={styles.visibilitySegment} role="radiogroup" aria-label="프로필 공개 여부">
              {(
                [
                  ['private', '비공개'],
                  ['followers', '팔로워'],
                  ['public', '공개'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={visibilityValue === value}
                  className={visibilityValue === value ? `${styles.visibilitySegmentBtn} ${styles.visibilitySegmentBtnActive}` : styles.visibilitySegmentBtn}
                  onClick={() => setVisibilityValue(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.submitBtn} onClick={save} disabled={saving || avatarUploading || usernameBlocking || emailBlocking || emailPasswordBlocking || !nicknameValue.trim()}>
            완료
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
