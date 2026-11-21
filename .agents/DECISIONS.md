# DECISIONS

오케스트레이터 판단 기록 (한 줄씩): `YYYY-MM-DD <작업ID> <판단> — <근거>`
2026-11-20 plan START=bde092be8ab9fd8d97b6cdaf1ec8716b839ac1bc — ai-social 8개 작업 승인(Bryan)
2026-11-20 ai-social-port 1회차 PASS → 커밋 — 209 tests·typecheck 통과, 비밀값·data 미포함 확인. enriched JSON(563KB, Reafy 페르소나 100명, 비밀번호 없음)은 personas 작업에서 교체 예정
2026-11-20 ai-social-client 1회차 PASS → 커밋 — 258 tests·typecheck 통과. QA 낮음 10건 중 #7(News slug 'ai-news')은 오판: 0054에서 slug가 'news'로 바뀜, backend NEWS_CATEGORY_SLUG='news'가 맞음. #6(봇 조회로 views 증가)은 사람처럼 보이는 목적상 수용. 나머지 낮음은 문서 갱신 때 TODO로
2026-11-20 ai-social-client 메모 — 로그인·가입 IP당 시간당 5회 제한: 10명 최초 가입은 몇 시간에 걸쳐 분산되거나 RATE_LIMIT_EXEMPT_CIDRS 결정 필요(Bryan, 최종 보고에 포함)
2026-11-20 ai-social-personas 1회차 PASS → 커밋 — 268 tests·typecheck 통과, 페르소나 10명 카테고리 1:1 확인. QA 낮음 7건: #5(longTimeoutMs 미사용)는 ai-social-review에서 소비, #4는 review 작업 LLM 테스트에 포함, 문서(#1·#2·#3) 정리는 docs 단계. Reafy 100명 JSON(미참조) 삭제는 Bryan 승인 사항이라 보류 — 최종 보고에서 질문
2026-11-20 ai-social-research 1회차 PASS → 커밋 — 343 tests·typecheck 통과, 의존성 readability 0.6.0·linkedom 0.18.15 고정. 넘길 것: #5(claim이 quote에 뒷받침되는지)→ai-social-review, #1(recordTopicUsage 호출)·#2(파이프라인 전체 데드라인·시도 축소)·#6(fetchArticle robots 주입 강제)·#3(이력 조회 성능)·#7(chunk 가드)→ai-social-integrate
2026-11-20 ai-social-research arXiv — export.arxiv.org robots.txt는 전체 Disallow지만 arXiv 공식 API 이용 약관(3초 간격)에 따라 사용 중. Bryan 확인 사항으로 최종 보고에 포함(빼려면 registry.ts의 arxiv 항목 제거)
2026-11-20 ai-social-review 1회차 FAIL(보통 4: 비-reasoning 동작 변경·제목 미검수·마커 없는 본문 passed·출처 URL 단독 줄이 OG 카드 N개) → 2회차 결정: 출처는 '- 출처명 URL' 인라인 줄, URL 단독 줄은 이미지 배치 전용, passed는 마커 문장 비율 ≥0.5 + 출처 ≥1
2026-11-20 ai-social-review 2회차 PASS → 커밋 — 410 tests·typecheck 통과. 낮음 3건(verifyDraft 직접 호출 시 미존재 cardId, 출처명 정리 안 함, 마크다운 위반 흐름·0.5 경계 테스트 없음)은 integrate에서 함께 처리. 실모델 폐기율은 드라이런으로 확인 필요(factual 필드 생략 시 폐기 증가 가능)
2026-11-20 ai-social-images 1회차 PASS → 커밋 — 452 tests·typecheck 통과. 프로브: 로컬 vision은 base64 data URL만 받음(원격 URL 400). integrate로 넘김: #2 vision 전 다운스케일(새 의존성 없이 macOS sips로 긴 변 1024px, 실패 시 해당 이미지 건너뜀), #1 frontend import 테스트가 tsc 프로그램에 섞이는 문제(tsconfig에서 테스트 분리 또는 계약 테스트 별도), #3 validateImage 시작 호스트 검사. 이미지 저작권·hotlink 깨짐은 Bryan 확인 사항
