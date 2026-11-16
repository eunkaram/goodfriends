import './src/load-env.ts';

// 🔒 테스트는 실제 LLM을 부르지 않는다 — .env에 LLM_API_KEY가 있으면 첫 댓글·
// 뉴스 요약 등이 네트워크 LLM을 호출해 느려지고(5s 타임아웃) 결과도 비결정적이 된다.
// 키를 지워 llm.ts의 stub 폴백을 강제한다(admin-digest-http.test.ts와 같은 원칙).
delete process.env.LLM_API_KEY;
