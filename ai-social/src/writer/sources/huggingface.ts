import type { Candidate } from '../types.js';
import { toIso } from './xml.js';

export function buildHfModelsUrl(opts: { pipelineTag?: string; limit?: number } = {}): string {
  const p = new URLSearchParams();
  if (opts.pipelineTag) p.set('pipeline_tag', opts.pipelineTag);
  p.set('sort', 'trendingScore');
  p.set('limit', String(opts.limit ?? 15));
  return `https://huggingface.co/api/models?${p.toString()}`;
}

export function buildHfPapersUrl(limit = 15): string {
  return `https://huggingface.co/api/daily_papers?limit=${limit}`;
}

/** 트렌딩 모델 → 후보. 모델 카드 URL. */
export function parseHfModels(json: unknown, sourceId: string): Candidate[] {
  if (!Array.isArray(json)) return [];
  const out: Candidate[] = [];
  for (const m of json) {
    const id = typeof m?.id === 'string' ? m.id : typeof m?.modelId === 'string' ? m.modelId : '';
    if (!id || m.private) continue;
    const bits = [m.pipeline_tag, typeof m.likes === 'number' ? `likes ${m.likes}` : '', typeof m.downloads === 'number' ? `downloads ${m.downloads}` : '']
      .filter(Boolean)
      .join(', ');
    out.push({
      title: `${id} (Hugging Face 트렌딩 모델)`,
      url: `https://huggingface.co/${id}`,
      sourceId,
      publishedAt: toIso(m.createdAt),
      summary: bits || undefined,
    });
  }
  return out;
}

/** Daily Papers → 후보. 논문 페이지 URL, summary는 초록. */
export function parseHfDailyPapers(json: unknown, sourceId: string): Candidate[] {
  if (!Array.isArray(json)) return [];
  const out: Candidate[] = [];
  for (const row of json) {
    const p = row?.paper ?? row;
    const id = typeof p?.id === 'string' ? p.id : '';
    const title = typeof (row?.title ?? p?.title) === 'string' ? String(row?.title ?? p?.title).replace(/\s+/g, ' ').trim() : '';
    if (!id || !title) continue;
    const summary = typeof p.summary === 'string' ? p.summary.replace(/\s+/g, ' ').trim() : '';
    out.push({
      title,
      url: `https://huggingface.co/papers/${id}`,
      sourceId,
      publishedAt: toIso(row?.publishedAt ?? p?.publishedAt),
      summary: summary ? summary.slice(0, 600) : undefined,
    });
  }
  return out;
}
