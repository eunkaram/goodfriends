'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Lounge.module.css';
import pageStyles from '../app/lounge/page.module.css';
import { detectFirstLink } from '../lib/link-detect.ts';
import { LinkPreviewCard } from './LinkPreviewCard.tsx';
import { LinkifiedText } from './LinkifiedText.tsx';
import { useIsEmailVerified } from './use-is-email-verified.ts';

type ReplyToSummary = { id: string; authorUsername: string; authorNickname: string | null; bodyExcerpt: string };

type ChatMessageView = {
  id: string;
  authorUsername: string;
  authorNickname: string | null;
  authorIsAgent: boolean;
  body: string;
  createdAt: string;
  replyTo: ReplyToSummary | null;
};

type OnlineUser = {
  userId: string;
  username: string;
  nickname: string | null;
  isAgent: boolean;
};

type Frame =
  | { type: 'history'; messages: ChatMessageView[] }
  | { type: 'message'; message: ChatMessageView }
  | { type: 'presence'; action: string; count: number; users: OnlineUser[] }
  | { type: 'error'; code: string; max?: number; windowSeconds?: number };

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function ReplyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 7 4 12l5 5" />
      <path d="M4 12h10a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

function DownArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v16M6 14l6 6 6-6" />
    </svg>
  );
}

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

/**
 * 🔒 사용자 지시(2026-10, "오른쪽 영역에 접속된 사용자 리스트도... 온라인상태도
 * 보여줘") — 채팅(메시지·연결 상태)과 접속자 목록이 같은 웹소켓 하나의
 * 상태를 공유해야 해서(연결을 두 번 열 이유가 없다) 한 컴포넌트가 둘 다
 * 들고 있다가, 반환할 때 `<main>`(채팅)과 `<aside>`(접속자 목록) 두 톱레벨
 * 엘리먼트를 Fragment로 나란히 내보낸다 — 페이지의 3단 그리드(`app/lounge/
 * page.module.css` `.layout`)가 DOM 순서대로 칸을 채우므로, 부모(app/lounge/page.tsx)가
 * `<aside className={styles.left}>`(좌 사이드바) 바로 뒤에 `<Lounge />`
 * 하나만 놓으면 center·right 칸에 각각 정확히 들어간다 — Context/Provider
 * 없이 React Fragment만으로 충분하다(이 기능은 /lounge 한 페이지에서만
 * 쓰여 재사용 가능한 추상화를 만들 이유가 없다).
 */
export function Lounge({ currentUsername }: { currentUsername: string }) {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [draft, setDraft] = useState('');
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  // 🔒 사용자 지시(2026-10-26, "이메일 미인증시 라운지 메뉴 접속시 메세지
  // 띄워줘") — 보기·입장 자체는 안 막는다(§11.9.3 원칙, EmailVerificationBanner.tsx
  // 주석 참고), 안내만 띄운다.
  const emailVerified = useIsEmailVerified();
  /** 🔒 사용자 지시(2026-10, "글에 댓글 달기도... 내 글에 원글이 일부
   * 포함되어야 하고 원글을 클릭하면 원글위치로 옮겨져서") — 답장 대상으로
   * 고른 메시지. 보내는 순간 WS 프레임에 `replyToId`로 실어 보낸다. */
  const [replyTarget, setReplyTarget] = useState<ChatMessageView | null>(null);
  /** 인용을 클릭했을 때 원글을 잠깐 강조(하이라이트)하는 용도 — 현재 로드된
   * 목록(최근 LOUNGE_HISTORY_LIMIT건) 밖이면 DOM에 없어 조용히 아무 일도
   * 안 한다(페이지네이션이 없어 그보다 오래된 원글로는 못 간다 — 범위 밖). */
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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
      setOnlineUsers([]);
      setPresenceCount(null);
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
        setPresenceCount(frame.count);
        setOnlineUsers(frame.users);
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

  /** 🔒 사용자 지시(2026-10, "스크롤이 위에 있을경우, 새글이 올라오면 새글표시를
   * 오른쪽에 아이콘이 플로팅되어서 아래로 갈수 있게") — 맨 아래 근처가
   * 아닐 때 도착한 새 말은 자동으로 스크롤하지 않는 대신(읽던 위치를
   * 밀어내면 안 되니) 이 플래그를 켜서 .listWrap 우하단에 버튼을 띄운다. */
  const [hasNewBelow, setHasNewBelow] = useState(false);

  // 🔒 사용자 지시(2026-10, "페이지 로드시 스크롤은 항상 아래에 최신 글") —
  // 첫 히스토리 로드는 nearBottom 휴리스틱 없이 무조건 맨 아래로(그 전까진
  // scrollHeight가 커도 scrollTop이 0이라 "안 보인다"). 이후 새 말이 오면
  // 사용자가 위로 올려 과거를 보는 중엔 건드리지 않는다.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (!didInitialScroll.current && messages.length > 0) {
      list.scrollTop = list.scrollHeight;
      didInitialScroll.current = true;
      return;
    }
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) list.scrollTop = list.scrollHeight;
    else setHasNewBelow(true);
  }, [messages]);

  // 사용자가 직접 끝까지 스크롤해 내리면 버튼을 치운다.
  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    if (nearBottom) setHasNewBelow(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    setHasNewBelow(false);
  }, []);

  const send = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const socket = wsRef.current;
      const body = draft.trim();
      if (!socket || socket.readyState !== socket.OPEN || body.length === 0) return;
      sentInFlight.current += 1;
      socket.send(JSON.stringify({ type: 'message', body, replyToId: replyTarget?.id }));
      setDraft('');
      setError(null);
      setReplyTarget(null);
    },
    [draft, replyTarget],
  );

  /** 🔒 "원글을 클릭하면 원글위치로 옮겨져서 원글이 보여지게" — 현재 로드된
   * 목록 안에서 DOM으로 찾아 스크롤 + 잠깐 강조. */
  const jumpToMessage = useCallback((id: string) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
    if (!el) return; // 히스토리 범위 밖 — 조용히 무시(위 highlightedId 주석 참고)
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(id);
    window.setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1500);
  }, []);

  return (
    <>
      <main className={pageStyles.center}>
        <h1 style={{ fontSize: 'var(--text-title-md)', margin: '0 0 var(--space-lg)' }}>Lounge</h1>

        <div className={styles.status}>
          <span className={connected ? styles.dotOn : styles.dotOff} aria-hidden />
          {connected ? '라운지 연결됨' : '연결 중…'}
          {presenceCount !== null && <span className={styles.presence}>· 접속 {presenceCount}명</span>}
        </div>

        {!emailVerified && (
          <p role="status" style={{ font: 'var(--text-label-sm)', color: 'var(--danger)', margin: '0 0 var(--space-sm)' }}>
            이메일 인증 전이에요. 인증 후 이용해주세요.
          </p>
        )}

        {/* 🔒 사용자 발견(2026-10, "오른쪽 스크롤바때문에 라운드처리가 안돼") —
            바깥(.listWrap)은 radius+overflow:hidden으로 모서리만 담당하고,
            실제 스크롤은 안쪽 `.list`로 옮긴다(ref도 그대로 안쪽에 둔다 —
            스크롤을 조작하는 쪽은 이 엘리먼트여야 한다). */}
        <div className={styles.listWrap}>
          <div className={styles.list} ref={listRef} onScroll={handleListScroll} aria-live="polite">
            {messages.length === 0 && <p className={styles.empty}>아직 말이 없어요 — 첫 인사를 건네보세요.</p>}
            {/* 🔒 사용자 지시(2026-10, "내글은 채팅리스트에서 오른쪽에... 메세지
                페이지의 UI를 따라가도 될것 같아") — MessagesView.tsx의
                bubbleRowMine/bubbleRowTheirs 패턴 그대로: 내 말풍선은 이름
                없이 오른쪽(accent 채움), 남 말풍선은 아바타+이름과 함께
                왼쪽(chip-bg). 1:1 DM과 달리 라운지는 "남"이 매번 다른
                사람이라 Messages처럼 고정된 otherUser가 없다 — authorNickname을
                매 메시지마다 그대로 쓴다(연속 발화 묶기 생략, 요청 범위 밖).
                🔒 사용자 지시(2026-10, "텍스트에 링크가 있으면 메세지 아래에
                카드형식으로... 카드는 글 메세지 다음에 보여져야지 메세지를
                중간에 끊고 두개이상으로 나누면 안돼") — 글·댓글이 쓰는
                LinkAwareBody는 링크 위치를 기준으로 본문을 앞/뒤로 "쪼개서"
                그 사이에 카드를 끼워 넣는다(원문 순서 보존이 목적) — 채팅에선
                그 쪼개짐 자체가 "메시지가 두 개로 나뉘어 보인다"는 문제였다.
                그래서 더 단순한 조합을 쓴다: 원문 전체를 LinkifiedText로
                한 말풍선에 통째로 그리고(문장 속 URL은 그 안에서 바로
                anchor로 클릭 가능 — "anchor태그여도 돼" 대안과 동일),
                링크가 있으면 그 말풍선 바로 다음에 LinkPreviewCard를
                추가로 붙인다. `compact`로 유튜브/영상 링크를 무거운 재생
                플레이어 대신 썸네일로만 보여준다(PostCard 등 다른 리스트
                문맥과 같은 이유). */}
            {messages.map((m) => {
              const mine = m.authorUsername === currentUsername;
              const link = detectFirstLink(m.body);
              const highlighted = m.id === highlightedId;
              const time = (
                <span className={styles.time}>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</span>
              );
              const preview = link && (
                <LinkPreviewCard
                  url={link.url}
                  youtubeVideoId={link.youtubeVideoId}
                  isYoutubeShorts={link.isYoutubeShorts}
                  isDirectImage={link.isDirectImage}
                  isDirectVideo={link.isDirectVideo}
                  isHlsVideo={link.isHlsVideo}
                  compact
                />
              );
              // 🔒 사용자 지시(2026-10, "내 글에 원글이 일부 포함되어야 하고
              // 원글을 클릭하면 원글위치로 옮겨져서 원글이 보여지게") —
              // 말풍선 "안"이 아니라 말풍선 스택의 맨 위(카드와 같은 위치,
              // 색 배경 밖)에 인용을 올린다 — 전체 원문처럼 보이면 안 되니
              // excerpt(서버가 80자로 잘라 보낸 값)만, 클릭하면 jumpToMessage.
              const quote = m.replyTo && (
                <button type="button" className={styles.quote} onClick={() => jumpToMessage(m.replyTo!.id)}>
                  <span className={styles.quoteAuthor}>{m.replyTo.authorNickname ?? m.replyTo.authorUsername}</span>
                  <span className={styles.quoteBody}>{m.replyTo.bodyExcerpt}</span>
                </button>
              );
              const replyButton = (
                <button type="button" className={styles.replyBtn} onClick={() => setReplyTarget(m)} aria-label="답장" title="답장">
                  <ReplyIcon />
                </button>
              );
              return mine ? (
                <div
                  key={m.id}
                  data-message-id={m.id}
                  className={highlighted ? `${styles.messageMine} ${styles.highlighted}` : styles.messageMine}
                >
                  <div className={styles.bubbleStackMine}>
                    {quote}
                    <div className={styles.bubbleMine}>
                      <LinkifiedText text={m.body} />
                    </div>
                    {preview}
                  </div>
                  <div className={styles.metaRow}>
                    {replyButton}
                    {time}
                  </div>
                </div>
              ) : (
                <div
                  key={m.id}
                  data-message-id={m.id}
                  className={highlighted ? `${styles.theirsRow} ${styles.highlighted}` : styles.theirsRow}
                >
                  <span className={styles.chatAvatar}>{initial(m.authorNickname ?? m.authorUsername)}</span>
                  <div className={styles.theirsContent}>
                    <div className={styles.theirsHead}>
                      <span className={styles.theirsName}>{m.authorNickname ?? m.authorUsername}</span>
                      {m.authorIsAgent && <span className={styles.agentBadge}>AI 에디터</span>}
                    </div>
                    <div className={styles.bubbleStackTheirs}>
                      {quote}
                      <div className={styles.bubbleTheirs}>
                        <LinkifiedText text={m.body} />
                      </div>
                      {preview}
                    </div>
                    <div className={styles.metaRow}>
                      {time}
                      {replyButton}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasNewBelow && (
            <button type="button" className={styles.newMessageBtn} onClick={scrollToBottom} aria-label="새 메시지로 이동" title="새 메시지">
              <DownArrowIcon />
            </button>
          )}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {/* 🔒 사용자 지시(2026-10, "댓글 달기하면 내 글에 원글이 일부
            포함되어야") — 답장 대상을 고르면 보내기 전에 무엇에 답장하는지
            보여주고, 실제 전송 본문(draft)엔 원문을 안 섞는다(서버가 이미
            replyToId로 원글 연결을 알아서 저장·브로드캐스트한다 — 본문에
            직접 인용 텍스트를 끼워 넣을 필요가 없다). */}
        {replyTarget && (
          <div className={styles.replyPreview}>
            <div className={styles.replyPreviewText}>
              <span className={styles.quoteAuthor}>{replyTarget.authorNickname ?? replyTarget.authorUsername}</span>님에게 답장 ·{' '}
              {replyTarget.body.length > 40 ? `${replyTarget.body.slice(0, 40)}…` : replyTarget.body}
            </div>
            <button type="button" className={styles.replyPreviewClose} onClick={() => setReplyTarget(null)} aria-label="답장 취소">
              ×
            </button>
          </div>
        )}

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
      </main>

      <aside className={pageStyles.right}>
        <div className={styles.onlineWidget}>
          <h3 className={styles.onlineTitle}>
            접속자 {onlineUsers.length > 0 && <span className={styles.onlineCount}>{onlineUsers.length}</span>}
          </h3>
          {onlineUsers.length === 0 ? (
            <p className={styles.onlineEmpty}>{connected ? '아직 아무도 없어요.' : '연결을 기다리는 중…'}</p>
          ) : (
            <ul className={styles.onlineList}>
              {onlineUsers.map((u) => (
                <li key={u.userId} className={styles.onlineRow}>
                  <span className={styles.onlineAvatar}>{initial(u.nickname ?? u.username)}</span>
                  <span className={styles.onlineName}>{u.nickname ?? u.username}</span>
                  {u.isAgent && <span className={styles.agentBadge}>AI 에디터</span>}
                  <span className={styles.onlineDot} aria-label="온라인" title="온라인" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
