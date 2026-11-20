/**
 * 어떤 LLM 공급자로 붙을지 결정하는 순수 함수. 네트워크/설정 읽기와 분리해서
 * 유닛테스트 가능하게 함.
 */

export interface LlmProviderConfig {
  name: 'local' | 'openrouter';
  baseUrl: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export interface LlmProviderInput {
  active: 'local' | 'openrouter';
  fallbackToOpenRouter: boolean;
  local: { baseUrl: string; apiKey: string; model: string };
  openRouter: { baseUrl: string; apiKey: string; model: string; siteUrl?: string; siteName?: string };
}

export interface ResolvedProviders {
  primary: LlmProviderConfig;
  fallback: LlmProviderConfig | null;
}

function buildLocalConfig(local: LlmProviderInput['local']): LlmProviderConfig {
  return { name: 'local', baseUrl: local.baseUrl, apiKey: local.apiKey, model: local.model };
}

function buildOpenRouterConfig(openRouter: LlmProviderInput['openRouter']): LlmProviderConfig {
  const extraHeaders: Record<string, string> = {};
  // OpenRouter 랭킹용 선택적 헤더 (https://openrouter.ai/docs) — 없어도 API는 동작함
  if (openRouter.siteUrl) extraHeaders['HTTP-Referer'] = openRouter.siteUrl;
  if (openRouter.siteName) extraHeaders['X-Title'] = openRouter.siteName;
  return {
    name: 'openrouter',
    baseUrl: openRouter.baseUrl,
    apiKey: openRouter.apiKey,
    model: openRouter.model,
    extraHeaders,
  };
}

/**
 * active='openrouter'면 OpenRouter가 주(primary), 폴백 없음(로컬이 딱히 더 안정적이지 않으므로).
 * active='local'(기본값)이면 로컬이 주. OPENROUTER_API_KEY가 있고 fallbackToOpenRouter가
 * 꺼져있지 않으면, 로컬이 완전히 실패했을 때 쓸 폴백으로 OpenRouter를 준비해둠.
 * 키가 없으면 폴백은 자동으로 비활성(의도치 않은 과금 방지).
 */
export function resolveProviders(input: LlmProviderInput): ResolvedProviders {
  const openRouterAvailable = Boolean(input.openRouter.apiKey);

  if (input.active === 'openrouter') {
    if (!openRouterAvailable) {
      throw new Error('LLM_PROVIDER=openrouter 이지만 OPENROUTER_API_KEY가 설정되지 않았습니다.');
    }
    return { primary: buildOpenRouterConfig(input.openRouter), fallback: null };
  }

  const fallback = input.fallbackToOpenRouter && openRouterAvailable ? buildOpenRouterConfig(input.openRouter) : null;
  return { primary: buildLocalConfig(input.local), fallback };
}
