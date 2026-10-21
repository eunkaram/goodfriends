'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Lounge.module.css';

type ChatMessageView = {
  id: string;
  authorUsername: string;
  authorNickname: string | null;
  authorIsAgent: boolean;
  body: string;
  createdAt: string;
};

type Frame =
  | { type: 'history'; messages: ChatMessageView[] }
  | { type: 'message'; message: ChatMessageView }
  | { type: 'presence'; action: string; count: number }
  | { type: 'error'; code: string; max?: number; windowSeconds?: number };

/**
 * 라운지 채팅 — M4("두 브라우저에서 실시간"). 전송은 `/ws/lounge`:
 * 🔒 WS는 next rewrites를 타지 않는다(rewrites가 HTTP만 프록시) — next.config.ts
 * 머리말의 같은 결론. 브라우저 같은 머신 다른 포트(:3011 → :3010)는 사이트
 * 기준이 같아 쿠키가 그대로 실린다(쿠키 도메인 매칭은 포트 무시) — 그래서
 * 백엔드 ws 핸드셰이크의 세션 검증이 동작한다. 운영에서는
 * NEXT_PUBLIC_LOUNGE_WS_BASE로 백엔드 wss 오리진을 덮어쓴다.
 */
function resolveLoungeWsUrl(): string {
  if (process.env.NEXT_PUBLIC_LOUNGE_WS_BASE) return `${process.env.NEXT_PUBLIC_LOUNGE_WS_BASE}/ws/lounge`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:3010/ws/lounge`;
}

export function Lounge() {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [presence, setPresence] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  /** 🔒 자기가 방금 보낸 말은 서버 id로 정렬되기 전에 띄우지 않는다 — 서버가
   * 브로드캐스트(자기 포함 all clients)하니 로컬 낙관렌더가 아니라 수신으로
   * 그리면 id·시간·중복이 전부 단 하나의 진실원(서버)으로 정렬된다. */
  const sentInFlight = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket(resolveLoungeWsUrl());
    wsRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = (event) => {
      setConnected(false);
      if (event.code === 4001) setError('라운지는 로그인한 멤버만 사용할 수 있어요.');
    };

    socket.onmessage = (event) => {
      let frame: Frame;
      try {
        frame = JSON.parse(event.data) as Frame;
      } catch {
        return;
      }
      if (frame.type === 'history') {
        setMessages(frame.messages);
      } else if (frame.type === 'message') {
        setMessages((prev) => (prev.some((m) => m.id === frame.message.id) ? prev : [...prev, frame.message]));
        sentInFlight.current = Math.max(0, sentInFlight.current - 1);
      } else if (frame.type === 'presence') {
        setPresence(frame.count);
      } else if (frame.type === 'error') {
        if (frame.code === 'RATE_LIMITED') setError(`너무 빨리 보내요 — ${frame.windowSeconds}초에 ${frame.max}개까지.`);
        else if (frame.code === 'INVALID_BODY') setError(`1,000자까지 보낼 수 있어요.`);
        else setError('보내기에 실패했어요.');
      }
    };

    return () => {
      socket.onclose = null;
      socket.close();
    };
  }, []);

  // 새 말이 오면 맨 아래로 스크롤 — 사용자가 위로 올려 복구하는 중엔 건드리지 않는다.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const send = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const socket = wsRef.current;
      const body = draft.trim();
      if (!socket || socket.readyState !== socket.OPEN || body.length === 0) return;
      sentInFlight.current += 1;
      socket.send(JSON.stringify({ type: 'message', body }));
      setDraft('');
      setError(null);
    },
    [draft],
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.status}>
        <span className={connected ? styles.dotOn : styles.dotOff} aria-hidden />
        {connected ? '라운지 연결됨' : '연결 중…'}
        {presence !== null && <span className={styles.presence}>· 접속 {presence}명</span>}
      </div>

      <div className={styles.list} ref={listRef} aria-live="polite">
        {messages.length === 0 && <p className={styles.empty}>아직 말이 없어요 — 첫 인사를 건네보세요.</p>}
        {messages.map((m) => (
          <div key={m.id} className={styles.row}>
            <div className={styles.head}>
              <span className={styles.author}>
                {m.authorNickname ?? m.authorUsername}
              </span>
              {m.authorIsAgent && <span className={styles.agentBadge}>AI 에디터</span>}
              <span className={styles.time}>
                {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className={styles.body}>{m.body}</p>
          </div>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <form className={styles.form} onSubmit={send}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          placeholder={connected ? '라운지에 말 남기기…' : '연결을 기다리는 중…'}
          aria-label="채팅 메시지"
          disabled={!connected}
        />
        <button type="submit" disabled={!connected || draft.trim().length === 0}>
          보내기
        </button>
      </form>
    </div>
  );
}
