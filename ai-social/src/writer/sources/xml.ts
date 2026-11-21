import { DOMParser } from 'linkedom';

/** 최소한의 XML 헬퍼 (RSS/Atom/arXiv Atom 파서 공용). */
export function parseXml(xml: string): any {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

export function childText(el: any, tag: string): string {
  const node = el.getElementsByTagName(tag)[0];
  return node ? String(node.textContent ?? '').trim() : '';
}

/** 날짜 문자열(RFC 822, ISO 8601 등) → ISO 8601. 해석 불가면 null. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** HTML 조각(RSS description 등) → 순수 텍스트. 태그 제거 + 기본 엔티티 해제 + 공백 정리. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}
