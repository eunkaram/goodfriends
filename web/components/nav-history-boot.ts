/**
 * 🔒 사용자 발견(2026-08, "어떤 위치든지 글 읽기에서 목록으로 가기 하면
 * 원래위치로 가야 할것 같아") — `BackToListLink`가 "뒤로 갈 진짜 앱 내
 * 기록이 있는지"를 판단해야 하는데, 이 앱은 전부 일반 `<a href>`라
 * (grep 확인 — `next/link` 사용처가 코드베이스에 하나도 없다) 페이지 이동마다
 * 매번 실제 하드 리로드가 일어난다. 판정 결과를 sessionStorage에 저장해서
 * `NavHistoryBoot`(루트 레이아웃, 매 페이지 로드마다 씀)와
 * `BackToListLink`(포스트 상세, 클릭 시점에 읽음)가 공유한다.
 *
 * 🔒 실측 발견 — 이 함수를 가드 없이 짜면 React StrictMode(dev 모드
 * 기본 켜짐)가 `useState` lazy initializer를 한 페이지 로드에 두 번
 * 호출해서, "읽고 나서 쓰는" 이 함수가 자기 자신과 경합한다: 1차 호출이
 * 정상적으로 false를 읽고 '0'을 쓰지만, 2차 호출이 그 사이 자신이 방금
 * 써둔 '1'(VISITED_KEY)을 다시 읽어버려 HAD_PRIOR_PAGE_KEY를 무조건
 * '1'로 덮어썼다 — 매번 "이전 페이지가 있었다"로 오판(직접 clear 후
 * 새로 이동해도 즉시 '1'로 확인). 같은 페이지 로드 안에서 딱 한 번만
 * 실행되도록 모듈 스코프 가드로 막는다.
 */
const VISITED_KEY = 'reafy_visited';
export const HAD_PRIOR_PAGE_KEY = 'reafy_had_prior_page';

let ranThisLoad = false;

export function markNavHistoryBoot() {
  if (typeof window === 'undefined' || ranThisLoad) return;
  ranThisLoad = true;
  const hadPriorPage = sessionStorage.getItem(VISITED_KEY) === '1';
  sessionStorage.setItem(VISITED_KEY, '1');
  sessionStorage.setItem(HAD_PRIOR_PAGE_KEY, hadPriorPage ? '1' : '0');
}
