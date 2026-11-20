import { describe, it, expect } from 'vitest';
import { resolveProviders, type LlmProviderInput } from './provider.js';

function baseInput(overrides: Partial<LlmProviderInput> = {}): LlmProviderInput {
  return {
    active: 'local',
    fallbackToOpenRouter: true,
    local: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', model: 'qwen2.5:14b' },
    openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', model: 'meta-llama/llama-3.1-8b-instruct' },
    ...overrides,
  };
}

describe('resolveProviders', () => {
  it('defaults to local as primary with no fallback when OpenRouter key is absent', () => {
    const { primary, fallback } = resolveProviders(baseInput());
    expect(primary.name).toBe('local');
    expect(fallback).toBeNull();
  });

  it('enables OpenRouter fallback when a key is present and fallback is not disabled', () => {
    const { primary, fallback } = resolveProviders(
      baseInput({ openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'm' } })
    );
    expect(primary.name).toBe('local');
    expect(fallback?.name).toBe('openrouter');
  });

  it('does not enable fallback when fallbackToOpenRouter is false, even with a key present', () => {
    const { fallback } = resolveProviders(
      baseInput({
        fallbackToOpenRouter: false,
        openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'm' },
      })
    );
    expect(fallback).toBeNull();
  });

  it('uses OpenRouter as primary with no fallback when active=openrouter', () => {
    const { primary, fallback } = resolveProviders(
      baseInput({ active: 'openrouter', openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'm' } })
    );
    expect(primary.name).toBe('openrouter');
    expect(fallback).toBeNull();
  });

  it('throws when active=openrouter but no API key is configured', () => {
    expect(() => resolveProviders(baseInput({ active: 'openrouter' }))).toThrow(/OPENROUTER_API_KEY/);
  });

  it('attaches optional OpenRouter ranking headers only when configured', () => {
    const withHeaders = resolveProviders(
      baseInput({
        openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'm', siteUrl: 'https://example.com', siteName: 'Reafy' },
      })
    );
    expect(withHeaders.fallback?.extraHeaders).toEqual({ 'HTTP-Referer': 'https://example.com', 'X-Title': 'Reafy' });

    const withoutHeaders = resolveProviders(
      baseInput({ openRouter: { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-or-x', model: 'm' } })
    );
    expect(withoutHeaders.fallback?.extraHeaders).toEqual({});
  });
});
