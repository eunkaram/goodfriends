'use client';

import { useEffect, useRef } from 'react';

type ThinSignal = { threadId: string; messageId: string; at: string };

/**
 * ws-server.ts가 갖고 있던 얇은 푸시({threadId, messageId, at}뿐, 본문 없음)를
 * 구독한다. web(Next.js)과 backend가 분리된 프로세스라(web 3011 / backend
 * 3010), Lounge.tsx와 같은 이유로 same-origin `/ws`가 아니라 backend 오리진에
 * 직접 붙는다 — `NEXT_PUBLIC_API_BASE_URL`(.env.example에 이미 문서화된 값,
 * lib/backend.ts의 서버 전용 `API_BASE_URL`의 클라이언트 노출판)에서 프로토콜만
 * http→ws로 바꿔 계산한다.
 *
 * 인증은 연결 직후 서버가 세션 쿠키로 판단해서, 없거나 무효하면 4001로
 * 닫는다(ws-server.ts) — 클라이언트는 그 실패도 재연결 루프에 맡긴다.
 *
 * 재연결은 지수 백오프(최대 30초) + 지터로 분산시킨다 — 서버 재시작 시
 * 모든 클라이언트가 동시에 재접속을 시도하는 부하 폭주를 피하기 위해서다.
 */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

export function useThreadSocket(onSignal: (signal: ThinSignal) => void) {
  const onSignalRef = useRef(onSignal);
  onSignalRef.current = onSignal;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    function connect() {
      const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3010';
      const wsUrl = apiBaseUrl.replace(/^http/, 'ws');
      ws = new WebSocket(`${wsUrl}/ws`);
      ws.onopen = () => {
        attempt = 0; // 연결 성공 — 다음에 끊기면 다시 짧은 지연부터 시작
      };
      ws.onmessage = (event) => {
        try {
          const signal = JSON.parse(event.data) as ThinSignal;
          onSignalRef.current(signal);
        } catch {
          // 형식이 깨진 메시지는 조용히 무시 — 실시간 편의 기능이라 크래시할 이유가 없다
        }
      };
      ws.onclose = () => {
        if (closedByUs) return;
        const backoff = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
        const jitter = Math.random() * backoff * 0.3; // ±0~30% 지터로 동시 재접속 분산
        attempt++;
        retryTimer = setTimeout(connect, backoff + jitter);
      };
    }

    connect();
    return () => {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, []);
}
