/**
 * /lounge — 라운지 채팅(M4, 전체방 1개). 로그인 게이트가 있는 화면 관례
 * (개인 로그·메시지 등과 동일): 서버에서 세션을 확인해 로그인이 아니면
 * LoginRequiredGate로 소프트 게이트, 연결은 Lounge(클라이언트)가 /ws/lounge로.
 */
import { LoginRequiredGate } from '../../components/LoginRequiredGate.tsx';
import { Lounge } from '../../components/Lounge.tsx';
import { fetchAccountSummary } from '../../lib/account.ts';
import { getSessionUserId } from '../../lib/session.ts';
import { fetchPublicCategoryTree } from '../../lib/categories.ts';

export const dynamic = 'force-dynamic';

export default async function LoungePage() {
  const [userId, tree] = await Promise.all([getSessionUserId(), fetchPublicCategoryTree().catch(() => ({ tree: [], popular: [] }))]);

  if (!userId) {
    return <LoginRequiredGate categoryTree={tree.tree} />;
  }

  return (
    <main>
      <h1 style={{ fontSize: 'var(--text-title-md)', margin: '0 0 var(--space-lg)' }}>라운지</h1>
      <Lounge />
    </main>
  );
}
