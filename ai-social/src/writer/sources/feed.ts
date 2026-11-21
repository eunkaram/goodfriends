import type { Candidate } from '../types.js';
import { childText, parseXml, stripHtml, toIso } from './xml.js';

const MAX_SUMMARY = 500;

/** RSS 2.0(<item>) / Atom(<entry>) 둘 다 지원. 링크·제목이 없는 항목은 버린다. */
export function parseFeed(xml: string, sourceId: string, max = 20): Candidate[] {
  const doc = parseXml(xml);
  const out: Candidate[] = [];

  for (const item of Array.from(doc.getElementsByTagName('item')) as any[]) {
    if (out.length >= max) break;
    const title = stripHtml(childText(item, 'title'));
    const url = childText(item, 'link');
    if (!title || !/^https?:\/\//.test(url)) continue;
    const desc = stripHtml(childText(item, 'description'));
    out.push({
      title,
      url,
      sourceId,
      publishedAt: toIso(childText(item, 'pubDate') || childText(item, 'dc:date')),
      summary: desc ? desc.slice(0, MAX_SUMMARY) : undefined,
    });
  }

  for (const entry of Array.from(doc.getElementsByTagName('entry')) as any[]) {
    if (out.length >= max) break;
    const title = stripHtml(childText(entry, 'title'));
    const links = Array.from(entry.getElementsByTagName('link')) as any[];
    const alt = links.find((l) => (l.getAttribute('rel') || 'alternate') === 'alternate') ?? links[0];
    const url = alt?.getAttribute('href') || '';
    if (!title || !/^https?:\/\//.test(url)) continue;
    const sum = stripHtml(childText(entry, 'summary') || childText(entry, 'content'));
    out.push({
      title,
      url,
      sourceId,
      publishedAt: toIso(childText(entry, 'published') || childText(entry, 'updated')),
      summary: sum ? sum.slice(0, MAX_SUMMARY) : undefined,
    });
  }
  return out;
}
