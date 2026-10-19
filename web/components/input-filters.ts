/**
 * 사용자 지시(2026-08-25, "이메일/비밀번호 입력창 영문만 입력 가능") — 로그인·
 * 회원가입·비번찾기 등 인증 폼 전체가 재사용한다. 한글 IME 등 비-ASCII 문자를
 * 제출 시점이 아니라 입력 시점에 걸러낸다.
 */
export function stripNonAscii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, '');
}

/** 사용자 지시(2026-08-25, "zipcode도 숫자만 입력가능하고 5자리까지만") — 숫자 외 문자 제거 + 길이 제한. */
export function stripNonDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}
