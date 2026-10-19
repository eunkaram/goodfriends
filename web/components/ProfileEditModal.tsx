'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalOpenEffect } from './use-modal-open-effect.ts';
import { ProfileLinksEditor } from './ProfileLinksEditor.tsx';
import { COUNTRIES } from '../lib/countries.ts';
import type { ProfileLink } from '../lib/user-log.ts';
import { stripNonAscii } from './input-filters.ts';
import styles from './ProfileEditModal.module.css';

function initial(nickname: string): string {
  return nickname.trim().slice(0, 1).toUpperCase() || '?';
}

// app/signup/page.tsx의 ChevronDownIcon과 같은 path.
function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  );
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

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h2.5l1.5-2h8l1.5 2H20a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}

/**
 * §11.7.6 프로필 편집 모달 — Claude Design 확정안(artifact `editOpen`)
 * 실측(디코딩 원본 line 1214-1273)을 이식했다.
 *
 * 🔒 후속(2026-08, "위치의 경우 zipcode를 입력하면 자동으로 지역을 처리해야해.
 * zipcode 인풋 폼 옆에 국가 선택폼을 같이 넣어줘... zipcode저장시 국가와
 * zip코드를 확인하고 잘못된 경우 에러를 띄워줘야해") — 자유 텍스트 "위치"
 * 필드를 없애고 가입 때부터 있던 `users.country`/`postal_code`를 직접
 * 편집하는 우편번호+국가 select 쌍으로 교체했다. 저장 시 서버(updateProfile)
 * 가 `postal_code_index`로 그 조합이 실제로 존재하는지 검증한다.
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
  country,
  postalCode,
  email,
  avatarUrl,
  links,
  onLinksChange,
  hasPassword,
  visibility,
  onClose,
  onSaved,
}: {
  nickname: string;
  username: string;
  intro: string;
  country: string | null;
  postalCode: string | null;
  /** 🔒 소셜 전용 계정은 null일 수 있다(이메일 자체를 등록한 적 없음) — 그 경우 빈 값으로 시작해 새로 추가할 수 있다. */
  email: string | null;
  /** 🔒 이메일을 바꿀 때 비밀번호 재확인을 보여줄지(updateEmail 재인증, src/auth.ts) — 비밀번호가 없는 소셜 전용 계정이면 false. */
  hasPassword: boolean;
  avatarUrl: string;
  links: ProfileLink[];
  onLinksChange: (next: ProfileLink[]) => void;
  visibility: 'public' | 'followers' | 'private';
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
  const [countryValue, setCountryValue] = useState(country ?? COUNTRIES[0].code);
  const [postalCodeValue, setPostalCodeValue] = useState(postalCode ?? '');
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
  const [locationPreview, setLocationPreview] = useState<string | null>(null);
  const [locationFormatValid, setLocationFormatValid] = useState(true);
  const [locationChecking, setLocationChecking] = useState(false);
  const locationCheckSeq = useRef(0);
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

  // 🔒 사용자 지시(2026-08, "zipcode를 입력하면 국가와 zipcode로 위치정보
  // (california, san jose)를 입력창 오른쪽에 보여줘") — 위 아이디 확인과
  // 같은 debounce+seq 패턴. 우편번호가 비어있으면 미리보기 자체가 무의미해
  // 조용히 지운다(에러 아님 — 우편번호는 선택 입력이라 비워도 저장된다).
  //
  // 🔒 사용자 발견(2026-08, "미국 zipcode 19134를 입력했는데 일치하는
  // 위치가 없대. 정상적인 zipcode야") — `validFormat`(형식 오류=빨강)과
  // `label`(있으면 초록 정보, 없어도 형식만 맞으면 저장 가능=중립)을
  // 분리해서 받는다 — "표에 없음"을 "형식이 틀림"처럼 빨갛게 보여주던 게
  // 원인이었다.
  useEffect(() => {
    const trimmedPostal = postalCodeValue.trim();
    if (trimmedPostal.length === 0) {
      setLocationPreview(null);
      setLocationFormatValid(true);
      setLocationChecking(false);
      return;
    }
    setLocationChecking(true);
    const seq = ++locationCheckSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/profile/location-preview?country=${encodeURIComponent(countryValue)}&postalCode=${encodeURIComponent(trimmedPostal)}`);
        if (locationCheckSeq.current !== seq) return; // 최신 입력값이 아닌 응답은 버린다
        if (!res.ok) {
          setLocationPreview(null);
          setLocationFormatValid(true);
          return;
        }
        const { validFormat, label } = (await res.json()) as { validFormat: boolean; label: string | null };
        setLocationFormatValid(validFormat);
        setLocationPreview(label);
      } catch {
        if (locationCheckSeq.current === seq) {
          setLocationPreview(null);
          setLocationFormatValid(true);
        }
      } finally {
        if (locationCheckSeq.current === seq) setLocationChecking(false);
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [countryValue, postalCodeValue]);

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
          country: countryValue,
          postalCode: postalCodeValue.trim(),
          avatarUrl: avatarUrlValue.trim(),
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
      // refresh를 부르면 그 직후 push와 경합한다. 위치 표시 문자열("서울,
      // 대한민국")은 서버의 postal_code_index 조인 결과라 여기서 재구성하지
      // 않는다 — router.refresh()가 다시 계산해온다(이메일도 같은 이유로
      // 여기서 로컬 상태를 안 만들고 서버 재조회에 맡긴다).
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
        <div className={styles.modalHeader}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            취소
          </button>
          <span className={styles.modalHeaderTitle}>프로필 편집</span>
          <button type="button" className={styles.saveBtn} onClick={save} disabled={saving || avatarUploading || usernameBlocking || emailBlocking || emailPasswordBlocking || !nicknameValue.trim()}>
            저장
          </button>
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
            <label className={styles.fieldLabel} htmlFor="profile-edit-postal">
              위치
            </label>
            {/* 🔒 사용자 지시(2026-08, "zipcode를 입력하면 자동으로 지역을
                처리해야해. zipcode 인풋 폼 옆에 국가 선택폼을 같이 넣어줘") —
                가입 때부터 있던 users.country/postal_code를 직접 편집한다.
                표시용 위치 문자열("서울, 대한민국")은 저장 후 서버가
                postal_code_index로 다시 계산한다(user-log.ts
                fetchUserLocationLabel). */}
            <div className={styles.locationRow}>
              <div className={styles.countrySelectWrap}>
                <select
                  id="profile-edit-country"
                  value={countryValue}
                  onChange={(e) => setCountryValue(e.target.value)}
                  className={styles.countrySelect}
                  aria-label="국가"
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className={styles.countrySelectChevron}>
                  <ChevronDownIcon />
                </span>
              </div>
              {/* 🔒 사용자 지시(2026-08, "zipcode를 입력하면 국가와 zipcode로
                  위치정보(california, san jose)를 입력창 오른쪽에 보여줘" →
                  후속 "미국 zipcode 19134... 정상적인 zipcode야. 제대로
                  검색이 안되는것 같아" → 후속(스크린샷) "텍스트를 빨간색박스
                  위치에 넣으라는거야") — 입력창과 같은 줄, 오른쪽에 인라인
                  으로 놓는다(말풍선/절대위치 없이). 형식 오류(빨강)와
                  "형식은 맞지만 상세 정보 없음"(중립 — postal_code_index가
                  대표값 8곳뿐이라 흔한 케이스, 저장은 그대로 가능하다)을
                  구분해서 보여준다. 우편번호가 비어있으면 아무것도 안
                  보여준다(선택 입력이라 에러가 아님). 🔒 후속(스크린샷,
                  "인풋 박스 사이즈는 고정. 그 위에... 메세지 div를
                  올리라고") — 입력창 자체 크기는 항상 고정, 메시지는 그
                  오른쪽 안쪽에 절대위치로 겹쳐서 뜬다. `<input>`은 자식을
                  못 가지므로 .postalFieldWrap로 감싸 그 안에서 기준점을
                  잡는다. */}
              <div className={styles.postalFieldWrap}>
                <input
                  id="profile-edit-postal"
                  type="text"
                  value={postalCodeValue}
                  onChange={(e) => setPostalCodeValue(e.target.value)}
                  maxLength={20}
                  placeholder="우편번호"
                  className={styles.postalInput}
                />
                {postalCodeValue.trim().length > 0 && (
                  <span
                    className={`${styles.checkOverlay} ${
                      locationChecking ? styles.checkNeutral : !locationFormatValid ? styles.checkBad : locationPreview ? styles.checkOk : styles.checkNeutral
                    }`}
                  >
                    {locationChecking
                      ? '확인 중...'
                      : !locationFormatValid
                        ? '형식 오류'
                        : (locationPreview ?? '상세 정보 없음')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>링크</span>
            <ProfileLinksEditor links={links} onLinksChange={onLinksChange} />
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
  );
}
