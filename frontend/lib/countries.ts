/**
 * §7 "미국 우선, 한국도 이용 가능" — 가입 폼·온보딩·프로필 위치 표시가
 * 전부 이 최소셋을 공유한다. 전체 국가 목록으로 확장할 땐 여기만 늘리면 된다.
 */
export const COUNTRIES = [
  { code: 'US', label: '미국' },
  { code: 'KR', label: '대한민국' },
];

export function countryLabel(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.label ?? code;
}
