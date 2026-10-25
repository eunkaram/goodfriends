'use client';

import { useEffect, useRef, useState } from 'react';
import { useThreadSocket } from './use-thread-socket.ts';
import { UnreadBadge } from './UnreadBadge.tsx';
import { AnnouncementBanner } from './AnnouncementBanner.tsx';
import { relativeTime } from './relative-time.ts';
import { useUnreadMessages } from './unread-messages-context.tsx';
import type { ThreadSummary, MessageItem } from '../lib/messages.ts';
import type { FollowingUser } from '../lib/relationships.ts';
import type { NotificationItem } from '../lib/notifications.ts';
import type { Announcement } from '../lib/announcements.ts';
import styles from './MessagesView.module.css';

function initial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '?';
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
}

function formatDateDivider(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** 스크롤 중에만 스크롤바를 보여주기 위한 상태 — 스크롤이 멎으면 일정 시간 뒤 다시 숨긴다. */
function useScrollingIndicator(timeoutMs = 700) {
  const [isScrolling, setIsScrolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  function onScroll() {
    setIsScrolling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsScrolling(false), timeoutMs);
  }
  return { isScrolling, onScroll };
}

function ComposeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

/** phone 전용 "목록으로" 버튼 — `.threadPanel`이 전체 화면을 차지하는 phone에서만 보인다. */
function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill="var(--accent)" />
      <path d="M12 16.5V7.5M8.5 11L12 7.5 15.5 11" fill="none" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** type별 문구 — 지금은 follow만 실제로 insert된다(intent-execution.ts),
 * 나머지는 스키마상 가능하지만 아직 어디서도 안 쓴다(향후 확장 지점). */
function notificationActionText(type: string): string {
  switch (type) {
    case 'follow':
      return '님을 팔로우하기 시작했습니다';
    case 'comment':
      return '님이 회원님의 글에 댓글을 남겼습니다';
    case 'reaction':
      return '님이 회원님의 글을 좋아합니다';
    case 'friend_request':
      return '님이 친구 신청을 보냈습니다';
    default:
      return '님이 새 알림을 보냈습니다';
  }
}

/**
 * goodfriends-ui 메시지 화면(디코딩 원본 line 473-600) — 좌: 활성 스레드
 * (헤더+메시지+입력창), 우: Inbox/Requests/Notification 탭+스레드 목록.
 *
 * 🔒 "전체검색"은 시안에 자리만 있고 전체 텍스트 검색 백엔드가 없어 범위
 * 밖이다(입력창 자체를 아예 안 둔다) · 그룹 스레드 · 이미지 첨부도 범위 밖.
 * "1건 제한" 등 실제 동작은 src/messages.ts를 따른다 — 시안 카피("3개까지")와
 * 다르다는 걸 그 파일 헤더에 기록해뒀다.
 */
export function MessagesView({
  initialThreads,
  connectedUsers,
  currentUserId,
  initialActiveThreadId,
  initialNotifications,
  announcements,
}: {
  initialThreads: { inbox: ThreadSummary[]; requests: ThreadSummary[] };
  connectedUsers: FollowingUser[];
  currentUserId: string;
  initialActiveThreadId?: string;
  initialNotifications: NotificationItem[];
  announcements: Announcement[];
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [tab, setTab] = useState<'inbox' | 'requests' | 'notification'>('inbox');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialActiveThreadId ?? null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScroll = useScrollingIndicator();
  const listScroll = useScrollingIndicator();
  const { setHasUnread } = useUnreadMessages();

  const allThreads = [...threads.inbox, ...threads.requests];
  const activeThread = allThreads.find((t) => t.id === activeThreadId) ?? null;

  const unreadInboxCount = threads.inbox.filter((t) => t.isUnread).length;
  const unreadRequestsCount = threads.requests.filter((t) => t.isUnread).length;
  const unreadNotificationCount = notifications.filter((n) => !n.isRead).length;

  // 페이지를 나갈 때(언마운트) 알림을 전부 읽음 처리한다 — 페이지에 있는
  // 동안은 NEW 표시를 계속 보여준다. cleanup 함수는 async를 기다려주지
  // 않으므로 fetch만 던지고 끝낸다.
  useEffect(() => {
    return () => {
      fetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
    };
  }, []);

  // 좌 사이드바 배지는 "이 목록에 안 읽은 스레드가 하나라도 있는가"를 그대로
  // 반영한다. 스레드를 열어서 그 스레드의 isUnread가 로컬로 꺼지면(아래
  // openThread) 자동으로 재계산되고, 다른 스레드가 아직 안 읽음이면 배지는
  // 계속 남는다.
  useEffect(() => {
    setHasUnread(allThreads.some((t) => t.isUnread));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  function markThreadReadLocally(threadId: string) {
    setThreads((prev) => ({
      inbox: prev.inbox.map((t) => (t.id === threadId ? { ...t, isUnread: false } : t)),
      requests: prev.requests.map((t) => (t.id === threadId ? { ...t, isUnread: false } : t)),
    }));
  }

  // 탭을 바꿀 땐 열려 있던 스레드를 닫는다. activeThreadId가 null이 되면
  // 아래 [activeThreadId] effect가 messages도 같이 비운다.
  function switchTab(next: 'inbox' | 'requests' | 'notification') {
    setTab(next);
    setActiveThreadId(null);
  }

  function onNotificationClick(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    fetch(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
  }

  function openThread(threadId: string) {
    setActiveThreadId(threadId);
    // 서버의 실제 읽음 처리(markThreadRead)는 loadMessages()의 POST가 담당한다
    // — 여기서는 화면(스레드 목록 배지 + 좌 사이드바)만 낙관적으로 먼저 지운다.
    markThreadReadLocally(threadId);
  }

  // `?thread=` 쿼리로 특정 대화가 이미 열린 채 진입한 경우(직접 링크 등) —
  // 클릭 경로(openThread)를 안 거쳐서 위 낙관적 처리를 놓친다. 마운트 시점에
  // 한 번 같은 처리를 해준다.
  useEffect(() => {
    if (initialActiveThreadId) markThreadReadLocally(initialActiveThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMessages(threadId: string) {
    try {
      const res = await fetch(`/api/messages/${threadId}`);
      if (!res.ok) return;
      const { messages: fetched } = (await res.json()) as { messages: MessageItem[] };
      setMessages(fetched);
      fetch(`/api/messages/${threadId}/read`, { method: 'POST' }).catch(() => {});
    } catch {
      // 순간적인 네트워크 장애 — 메시지 자체는 이미 발송된 뒤라 조용히 넘어간다.
      // 다음 로드나 실시간 신호가 오면 자연히 다시 채워진다.
    }
  }

  useEffect(() => {
    if (activeThreadId) loadMessages(activeThreadId);
    else setMessages([]);
    setLimitReached(false);
    setSendError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useThreadSocket((signal) => {
    if (signal.threadId === activeThreadId) {
      loadMessages(signal.threadId);
    }
    // 목록의 마지막 메시지 미리보기도 최신으로 — 전체 스레드 목록을 다시 받는다(가벼운 편의 갱신).
    fetch('/api/messages/threads')
      .then((res) => res.json())
      .then((fresh) => setThreads(fresh))
      .catch(() => {});
  });

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!activeThreadId || !draft.trim() || sending) return;
    setSending(true);
    setSendError(false);
    try {
      const res = await fetch(`/api/messages/${activeThreadId}`, { method: 'POST', body: JSON.stringify({ body: draft.trim() }) });
      if (res.status === 400) {
        const { error } = await res.json();
        if (error === 'LIMIT_REACHED') setLimitReached(true);
        return;
      }
      if (!res.ok) {
        setSendError(true);
        return;
      }
      setDraft('');
      setLimitReached(false);
      await loadMessages(activeThreadId);
    } catch {
      // 발송 자체가 실패한 경우라 draft를 지우지 않고 사용자가 다시 보낼 수 있게 남겨둔다.
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  async function onStartThread(otherUserId: string) {
    setComposeOpen(false);
    let threadId: string;
    try {
      const res = await fetch('/api/messages/thread', { method: 'POST', body: JSON.stringify({ otherUserId }) });
      if (!res.ok) return;
      ({ threadId } = (await res.json()) as { threadId: string });
      const fresh = await (await fetch('/api/messages/threads')).json();
      setThreads(fresh);
    } catch {
      return; // 네트워크 일시 장애 — 조용히 넘어간다(위 loadMessages와 같은 이유)
    }
    setActiveThreadId(threadId);
  }

  return (
    <div className={styles.page} data-active={!!activeThread}>
      <div className={styles.header}>
        <div className={styles.pageTitle}>Messages</div>
        {tab !== 'notification' && (
          <button type="button" className={styles.composeBtn} onClick={() => setComposeOpen((v) => !v)} aria-label="새 메시지">
            <ComposeIcon />
          </button>
        )}
        {composeOpen && tab !== 'notification' && (
          <div className={styles.composePopover}>
            {/* 🔒 사용자 발견(2026-10, "오른쪽 스크롤바때문에 라운드처리가 안돼") —
                ProfileEditModal .modal과 같은 원인·같은 해법 — 바깥(.composePopover)은
                radius+overflow:hidden, 실제 스크롤은 안쪽으로 옮긴다. */}
            <div className={styles.composePopoverScroll}>
              <div className={styles.composePopoverTitle}>메시지 보내기</div>
              {connectedUsers.length === 0 ? (
                <p className={styles.emptySmall}>팔로우하거나 팔로우한 사람이 없어요.</p>
              ) : (
                connectedUsers.map((u) => (
                  <button key={u.id} type="button" className={styles.composeFriendRow} onClick={() => onStartThread(u.id)}>
                    <span className={styles.avatarSm}>{initial(u.nickname)}</span>
                    {u.nickname}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <AnnouncementBanner announcements={announcements} />

      <div className={styles.tabBar}>
        <div className={styles.tabBarChat}>
          <div className={styles.tabList}>
            <button type="button" className={tab === 'inbox' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => switchTab('inbox')}>
              <span className={styles.tabLabel}>Inbox</span>
              {unreadInboxCount > 0 && <span className={styles.tabCountBadge}>{unreadInboxCount}</span>}
            </button>
            <button
              type="button"
              className={tab === 'requests' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => switchTab('requests')}
            >
              <span className={styles.tabLabel}>Requests</span>
              {unreadRequestsCount > 0 && <span className={styles.tabCountBadge}>{unreadRequestsCount}</span>}
            </button>
            <button
              type="button"
              className={tab === 'notification' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => switchTab('notification')}
            >
              <span className={styles.tabLabel}>Notification</span>
              {unreadNotificationCount > 0 && <span className={styles.tabCountBadge}>{unreadNotificationCount}</span>}
            </button>
          </div>
        </div>

        {/* 채팅창(threadPanel flex:1) 폭에만 밑줄이 깔리게 목록 폭(280px)만큼 빈 칸을 유지한다. */}
        <div className={styles.tabBarSide} />
      </div>

      {tab === 'notification' ? (
        <div className={styles.notificationList}>
          {notifications.length === 0 ? (
            <p className={styles.emptySmall}>알림이 없어요.</p>
          ) : (
            notifications.map((n) => {
              const actorLabel = n.actorNickname ?? n.actorUsername ?? '?';
              const actorLink = n.actorUsername ? (
                <a
                  href={`/@${n.actorUsername}`}
                  className={styles.notificationActor}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNotificationClick(n.id);
                  }}
                >
                  <span className={styles.avatarSm}>{initial(actorLabel)}</span>
                  <strong>{actorLabel}</strong>
                </a>
              ) : (
                <span className={styles.notificationActor}>
                  <span className={styles.avatarSm}>{initial(actorLabel)}</span>
                  <strong>{actorLabel}</strong>
                </span>
              );
              return (
                <div
                  key={n.id}
                  className={styles.notificationRow}
                  role="button"
                  tabIndex={0}
                  onClick={() => onNotificationClick(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onNotificationClick(n.id);
                  }}
                >
                  <span className={styles.notificationBody}>
                    <span className={styles.notificationText}>
                      {actorLink} {notificationActionText(n.type)}
                      {!n.isRead && <span className={styles.newBadge}>NEW</span>}
                    </span>
                  </span>
                  <span className={styles.notificationTime}>{relativeTime(n.createdAt)}</span>
                </div>
              );
            })
          )}
        </div>
      ) : (
      <div className={styles.split}>
        <div className={styles.threadPanel}>
          {!activeThread ? (
            <p className={styles.empty}>대화를 선택해주세요.</p>
          ) : (
            <>
              <div className={styles.threadHeader}>
                <button type="button" className={styles.backBtn} onClick={() => setActiveThreadId(null)} aria-label="목록으로">
                  <BackIcon />
                </button>
              </div>

              <div
                className={messagesScroll.isScrolling ? `${styles.messages} ${styles.scrolling}` : styles.messages}
                onScroll={messagesScroll.onScroll}
              >
                {messages.length === 0 && activeThread.isRequest && (
                  <div className={styles.requestNotice}>
                    <div className={styles.requestNoticeTitle}>{activeThread.otherUser.nickname}님에게 메시지 요청 보내기</div>
                    <div className={styles.requestNoticeSub}>상대가 수락하기 전까지 1건만 보낼 수 있어요.</div>
                  </div>
                )}
                {messages.map((m, i) => {
                  const mine = m.senderId === currentUserId;
                  const showDivider = i === 0 || !isSameDay(messages[i - 1].createdAt, m.createdAt);
                  // 연속된 상대 메시지 묶음의 첫 메시지에만 아바타+닉네임을 보여준다(날짜가 바뀌어도 새 묶음 취급).
                  const isFirstOfGroup = i === 0 || messages[i - 1].senderId !== m.senderId || showDivider;
                  const time = <span className={styles.messageTime}>{formatMessageTime(m.createdAt)}</span>;
                  return (
                    <div key={m.id}>
                      {showDivider && (
                        <div className={styles.dateDivider}>
                          <span>{formatDateDivider(m.createdAt)}</span>
                        </div>
                      )}
                      {mine ? (
                        <div className={styles.bubbleRowMine}>
                          {time}
                          <div className={styles.bubbleMine}>{m.body}</div>
                        </div>
                      ) : (
                        <div className={styles.theirsRow}>
                          <div className={styles.theirsAvatarCol}>
                            {isFirstOfGroup && <span className={styles.avatarSm}>{initial(activeThread.otherUser.nickname)}</span>}
                          </div>
                          <div className={styles.theirsContent}>
                            {isFirstOfGroup && <div className={styles.theirsName}>{activeThread.otherUser.nickname}</div>}
                            <div className={styles.bubbleRowTheirs}>
                              <div className={styles.bubbleTheirs}>{m.body}</div>
                              {time}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {limitReached && (
                <p className={styles.limitNotice}>상대가 아직 수락하지 않았어요 — 수락 전까지는 1건만 보낼 수 있어요.</p>
              )}
              {sendError && <p className={styles.limitNotice}>메시지를 보내지 못했어요 — 다시 시도해주세요.</p>}

              <form className={styles.composer} onSubmit={onSend}>
                <input
                  type="text"
                  placeholder="메시지를 입력하세요..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="메시지 입력"
                  maxLength={2000}
                />
                <button type="submit" className={styles.sendBtn} disabled={sending || !draft.trim()} aria-label="보내기">
                  <SendIcon />
                </button>
              </form>
            </>
          )}
        </div>

        <div
          className={listScroll.isScrolling ? `${styles.listPanel} ${styles.scrolling}` : styles.listPanel}
          onScroll={listScroll.onScroll}
        >
          {(tab === 'inbox' ? threads.inbox : threads.requests).length === 0 ? (
            <p className={styles.emptySmall}>{tab === 'inbox' ? '아직 주고받은 대화가 없어요.' : '받은 요청이 없어요.'}</p>
          ) : (
            (tab === 'inbox' ? threads.inbox : threads.requests).map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === activeThreadId ? `${styles.threadRow} ${styles.threadRowActive}` : styles.threadRow}
                onClick={() => openThread(t.id)}
              >
                <span className={styles.avatarSm}>{initial(t.otherUser.nickname)}</span>
                <span className={styles.threadRowText}>
                  <span className={styles.threadRowName}>
                    {t.otherUser.nickname}
                    {t.isUnread && <UnreadBadge />}
                  </span>
                  <span className={styles.threadRowPreview}>{t.lastMessage?.body ?? ''}</span>
                </span>
                {t.lastMessage && <span className={styles.threadRowTime}>{relativeTime(t.lastMessage.createdAt)}</span>}
              </button>
            ))
          )}
        </div>
      </div>
      )}
    </div>
  );
}
