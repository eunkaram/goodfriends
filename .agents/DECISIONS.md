# DECISIONS

오케스트레이터 판단 기록 (한 줄씩): `YYYY-MM-DD <작업ID> <판단> — <근거>`
2026-11-20 plan START=bde092be8ab9fd8d97b6cdaf1ec8716b839ac1bc — ai-social 8개 작업 승인(Bryan)
2026-11-20 ai-social-port 1회차 PASS → 커밋 — 209 tests·typecheck 통과, 비밀값·data 미포함 확인. enriched JSON(563KB, Reafy 페르소나 100명, 비밀번호 없음)은 personas 작업에서 교체 예정
2026-11-20 ai-social-client 1회차 PASS → 커밋 — 258 tests·typecheck 통과. QA 낮음 10건 중 #7(News slug 'ai-news')은 오판: 0054에서 slug가 'news'로 바뀜, backend NEWS_CATEGORY_SLUG='news'가 맞음. #6(봇 조회로 views 증가)은 사람처럼 보이는 목적상 수용. 나머지 낮음은 문서 갱신 때 TODO로
2026-11-20 ai-social-client 메모 — 로그인·가입 IP당 시간당 5회 제한: 10명 최초 가입은 몇 시간에 걸쳐 분산되거나 RATE_LIMIT_EXEMPT_CIDRS 결정 필요(Bryan, 최종 보고에 포함)
