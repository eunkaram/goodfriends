-- 0028 — 위치 편집을 자유 텍스트에서 우편번호+국가로 교체(사용자 지시,
-- 2026-08 — "위치의 경우 zipcode를 입력하면 자동으로 지역을 처리해야해.
-- zipcode 인풋 폼 옆에 국가 선택폼을 같이 넣어줘(가입할때 입력한 정보야)
-- zipcode저장시 국가와 zip코드를 확인하고 잘못된 경우 에러를 띄워줘야해")
--
-- 0025가 만들었던 user_logs.location(자유 텍스트 오버라이드)이 이 라운드로
-- 완전히 대체된다 — 편집 UI가 이제 users.country/postal_code(가입 때부터
-- 있던 필드)를 직접 고치고, postal_code_index로 실시간 검증한다. 더 이상
-- 어떤 코드도 이 컬럼을 읽거나 쓰지 않아 드롭한다(빈 문자열 오버라이드가
-- 남아있어도 fetchUserLocationLabel()이 이제 그 값을 보지 않으므로 어차피
-- 죽은 데이터가 될 것 — 다음에 이 파일을 보는 사람이 헷갈리지 않게 지운다).

BEGIN;

ALTER TABLE user_logs DROP COLUMN location;

COMMIT;
