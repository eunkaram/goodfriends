/**
 * 링크 감지 — §11.9.2류 "thread처럼 자동 임베드"(사용자 지시, 2026-08)의 기반 유틸.
 */
import { describe, expect, it } from 'vitest';
import {
  detectFirstLink,
  isDirectImageUrl,
  isDirectVideoUrl,
  isHlsUrl,
  hasImageMarkers,
  parseBodyWithImageMarkers,
  makeImageMarker,
  youtubeThumbnailUrl,
  stripFirstLink,
  splitAroundLink,
  parseBodySegments,
  hasStandaloneMediaLine,
  truncatePreview,
} from '../../src/link-detect.ts';

describe('detectFirstLink', () => {
  it('링크가 없으면 null', () => {
    expect(detectFirstLink('그냥 평범한 글이에요')).toBeNull();
  });

  it('일반 링크는 youtubeVideoId가 null, isDirectImage·isDirectVideo·isYoutubeShorts·isHlsVideo도 false', () => {
    const result = detectFirstLink('오늘 이 글 봤어요 https://example.com/article 재밌네요');
    expect(result).toEqual({
      url: 'https://example.com/article',
      youtubeVideoId: null,
      isYoutubeShorts: false,
      isDirectImage: false,
      isDirectVideo: false,
      isHlsVideo: false,
    });
  });

  it('watch?v= 형태의 유튜브 링크에서 video ID를 뽑는다', () => {
    const result = detectFirstLink('이 영상 보세요 https://www.youtube.com/watch?v=dQw4w9WgXcQ 강추');
    expect(result?.youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('youtu.be 단축 링크에서도 video ID를 뽑는다', () => {
    const result = detectFirstLink('https://youtu.be/dQw4w9WgXcQ');
    expect(result?.youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('watch?v= 뒤에 다른 쿼리(&list=, &t=)가 붙어도 video ID만 정확히 뽑는다', () => {
    const result = detectFirstLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&t=42s');
    expect(result?.youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  it('m.youtube.com(모바일 서브도메인)도 인식한다', () => {
    const result = detectFirstLink('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result?.youtubeVideoId).toBe('dQw4w9WgXcQ');
  });

  // 🔒 실전 발견(2026-08, 사용자 리포트 — "쇼츠를 입력했는데도 가로로 출력") —
  // 유튜브 oEmbed가 Shorts에도 일반 영상과 같은 16:9 기본값을 그대로 돌려줘서
  // (실측 확인), URL이 `/shorts/`인지를 대신 신뢰할 수 있는 세로 판별 신호로 쓴다.
  it('🔒 /shorts/ 링크는 isYoutubeShorts=true, video ID도 정확히 뽑는다', () => {
    const result = detectFirstLink('https://youtube.com/shorts/FiVP6wLSjls?si=abc123');
    expect(result?.youtubeVideoId).toBe('FiVP6wLSjls');
    expect(result?.isYoutubeShorts).toBe(true);
  });

  it('일반 watch?v=/youtu.be 링크는 isYoutubeShorts=false', () => {
    expect(detectFirstLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.isYoutubeShorts).toBe(false);
    expect(detectFirstLink('https://youtu.be/dQw4w9WgXcQ')?.isYoutubeShorts).toBe(false);
  });

  it('여러 링크가 있어도 첫 번째만 반환한다', () => {
    const result = detectFirstLink('https://example.com/first https://youtu.be/dQw4w9WgXcQ');
    expect(result?.url).toBe('https://example.com/first');
    expect(result?.youtubeVideoId).toBeNull();
  });

  // 🔒 사용자 발견 — "외부에서 긁어온 내용을 붙여 넣으니 외부 이미지는 로딩이 안돼"
  it('이미지 확장자로 끝나는 링크는 isDirectImage=true', () => {
    expect(detectFirstLink('사진 봐요 https://example.com/photo.jpg')?.isDirectImage).toBe(true);
    expect(detectFirstLink('https://example.com/a/b/c.PNG')?.isDirectImage).toBe(true); // 대소문자 무관
    expect(detectFirstLink('https://cdn.example.com/img.webp?w=800')?.isDirectImage).toBe(true); // 쿼리스트링 붙어도 인식
  });

  it('이미지 확장자가 아니면 isDirectImage=false', () => {
    expect(detectFirstLink('https://example.com/article')?.isDirectImage).toBe(false);
    expect(detectFirstLink('https://youtu.be/dQw4w9WgXcQ')?.isDirectImage).toBe(false);
  });

  // 🔒 사용자 지시(2026-08) — "미디어나 이미지를 넣을 경우 태그로 전환해서 페이지에서 바로 볼수 있도록"
  it('영상 확장자로 끝나는 링크는 isDirectVideo=true', () => {
    const result = detectFirstLink('영상 보세요 http://video.twimg.com/amplify_video/2083451675684265984/vid/avc1/1280x720/Qy0XtcRjRQfTj3xo.mp4');
    expect(result?.isDirectVideo).toBe(true);
    expect(result?.isDirectImage).toBe(false);
  });

  it('영상 확장자가 아니면 isDirectVideo=false', () => {
    expect(detectFirstLink('https://example.com/article')?.isDirectVideo).toBe(false);
    expect(detectFirstLink('https://example.com/photo.jpg')?.isDirectVideo).toBe(false);
  });

  // 🔒 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의 url을 입력하면...
  // 최소한으로 작업해줘")
  it('m3u8 링크는 isHlsVideo=true, isDirectVideo=false', () => {
    const result = detectFirstLink('라이브 보세요 https://cdn.example.com/live/stream.m3u8');
    expect(result?.isHlsVideo).toBe(true);
    expect(result?.isDirectVideo).toBe(false);
  });

  it('m3u8이 아니면 isHlsVideo=false', () => {
    expect(detectFirstLink('https://example.com/clip.mp4')?.isHlsVideo).toBe(false);
    expect(detectFirstLink('https://example.com/article')?.isHlsVideo).toBe(false);
  });
});

describe('isDirectImageUrl', () => {
  it('jpg·jpeg·png·gif·webp·avif·svg를 전부 인식한다', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg']) {
      expect(isDirectImageUrl(`https://example.com/x.${ext}`)).toBe(true);
    }
  });

  it('이미지가 아닌 확장자는 false', () => {
    expect(isDirectImageUrl('https://example.com/x.html')).toBe(false);
    expect(isDirectImageUrl('https://example.com/x.pdf')).toBe(false);
  });
});

describe('isDirectVideoUrl', () => {
  it('mp4·webm·mov·m4v·ogv를 전부 인식한다', () => {
    for (const ext of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) {
      expect(isDirectVideoUrl(`https://example.com/x.${ext}`)).toBe(true);
    }
  });

  it('쿼리스트링이 붙어도 인식한다', () => {
    expect(isDirectVideoUrl('https://cdn.example.com/clip.mp4?token=abc')).toBe(true);
  });

  it('영상이 아닌 확장자는 false', () => {
    expect(isDirectVideoUrl('https://example.com/x.jpg')).toBe(false);
    expect(isDirectVideoUrl('https://example.com/x.html')).toBe(false);
  });

  it('m3u8은 isDirectVideoUrl이 아니다(HLS는 별도 판별)', () => {
    expect(isDirectVideoUrl('https://example.com/stream.m3u8')).toBe(false);
  });
});

// 🔒 사용자 지시(2026-08, "m3u8같이 스트리밍 형태의 url을 입력하면...
// 최소한으로 작업해줘")
describe('isHlsUrl', () => {
  it('.m3u8로 끝나는 링크를 인식한다', () => {
    expect(isHlsUrl('https://example.com/stream.m3u8')).toBe(true);
  });

  it('쿼리스트링이 붙어도 인식한다', () => {
    expect(isHlsUrl('https://cdn.example.com/live/index.m3u8?token=abc')).toBe(true);
  });

  it('m3u8이 아니면 false(mp4를 isDirectVideo로 오분류하지 않는지 교차 확인)', () => {
    expect(isHlsUrl('https://example.com/x.mp4')).toBe(false);
    expect(isHlsUrl('https://example.com/x.html')).toBe(false);
  });
});

// 🔒 사용자 지시(2026-08, "글 리스트와 내용보기에서 이미지/영상처럼
// 페이지에서 노출되면 링크는 안보여주면 좋겠어. 대신 노출이 안되는경우는
// 링크가 보여야해") — LinkAwareBody가 미리보기 성공 시 본문 텍스트에서
// 링크를 지우는 데 쓰는 순수 함수.
describe('stripFirstLink', () => {
  it('링크만 있으면 빈 문자열을 반환한다', () => {
    expect(stripFirstLink('https://example.com/a.jpg', 'https://example.com/a.jpg')).toBe('');
  });

  it('링크 앞에 텍스트가 있으면 그 텍스트만 남긴다(끝 공백 제거)', () => {
    expect(stripFirstLink('사진 https://example.com/a.jpg', 'https://example.com/a.jpg')).toBe('사진');
  });

  it('링크 뒤에 텍스트가 있으면 그 텍스트만 남긴다(앞 공백 제거)', () => {
    expect(stripFirstLink('https://example.com/a.jpg 봤어요', 'https://example.com/a.jpg')).toBe('봤어요');
  });

  it('링크 앞뒤에 텍스트가 둘 다 있으면 공백 하나로 이어붙인다', () => {
    expect(stripFirstLink('오늘 https://example.com/a.jpg 봤어요', 'https://example.com/a.jpg')).toBe('오늘 봤어요');
  });

  it('줄바꿈으로 감싸도 앞뒤 텍스트만 공백 하나로 이어붙인다', () => {
    expect(stripFirstLink('첫 줄\nhttps://example.com/a.jpg\n마지막 줄', 'https://example.com/a.jpg')).toBe('첫 줄 마지막 줄');
  });

  it('본문에 없는 url을 넘기면 원문 그대로 반환한다', () => {
    expect(stripFirstLink('그냥 평범한 글이에요', 'https://example.com/a.jpg')).toBe('그냥 평범한 글이에요');
  });
});

// 🔒 사용자 발견(2026-08, "글 내용보기 페이지의 글 순서가 이상하네...
// 유튜브, 글 내용순이거든. 근데 글내용과 유튜브가 분리되어서 나와") —
// LinkAwareBody가 원문 순서 그대로(앞 텍스트 → 미리보기 → 뒤 텍스트)
// 렌더링할 수 있도록 앞/뒤를 합치지 않고 분리해서 돌려주는 함수.
describe('splitAroundLink', () => {
  it('링크만 있으면 앞/뒤 모두 빈 문자열', () => {
    expect(splitAroundLink('https://example.com/a.jpg', 'https://example.com/a.jpg')).toEqual({ before: '', after: '' });
  });

  it('링크가 맨 앞이면 before는 비고 after만 남는다', () => {
    expect(splitAroundLink('https://example.com/a.jpg 봤어요', 'https://example.com/a.jpg')).toEqual({
      before: '',
      after: '봤어요',
    });
  });

  it('링크가 맨 뒤면 after는 비고 before만 남는다', () => {
    expect(splitAroundLink('사진 https://example.com/a.jpg', 'https://example.com/a.jpg')).toEqual({
      before: '사진',
      after: '',
    });
  });

  it('링크가 중간이면 앞/뒤를 합치지 않고 각각 반환한다(합치던 stripFirstLink와의 핵심 차이)', () => {
    expect(splitAroundLink('오늘 https://example.com/a.jpg 봤어요', 'https://example.com/a.jpg')).toEqual({
      before: '오늘',
      after: '봤어요',
    });
  });

  it('줄바꿈으로 감싸도 각 문단이 따로 보존된다', () => {
    expect(splitAroundLink('첫 줄\nhttps://example.com/a.jpg\n마지막 줄', 'https://example.com/a.jpg')).toEqual({
      before: '첫 줄',
      after: '마지막 줄',
    });
  });

  it('본문에 없는 url을 넘기면 전체가 before로, after는 빈 문자열', () => {
    expect(splitAroundLink('그냥 평범한 글이에요', 'https://example.com/a.jpg')).toEqual({
      before: '그냥 평범한 글이에요',
      after: '',
    });
  });
});

describe('youtubeThumbnailUrl', () => {
  it('영상 ID로 공개 썸네일 CDN URL을 만든다', () => {
    expect(youtubeThumbnailUrl('dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  });
});

// 🔒 사용자 발견(2026-08) — "이미지가 여러개 있는것을 긁어서 붙여넣었는데
// 이미지 하나만 등록. 이미지 링크와 이미지명도 보이면 안돼. 긁어온 내용이
// 그대로 붙여져서 저장되어야해."
describe('makeImageMarker / hasImageMarkers / parseBodyWithImageMarkers', () => {
  it('마커 문자열 자체에는 눈에 보이는 "IMG:" 접두어가 없다(제어문자로 시작)', () => {
    const marker = makeImageMarker('https://example.com/a.jpg');
    expect(marker.startsWith('IMG:')).toBe(false); // 순수 "IMG:"로는 시작 안 함 — 제어문자가 먼저 옴
    expect(marker.includes('https://example.com/a.jpg')).toBe(true);
  });

  it('마커가 없는 일반 본문은 hasImageMarkers=false', () => {
    expect(hasImageMarkers('그냥 평범한 글이에요')).toBe(false);
  });

  it('마커가 있으면 hasImageMarkers=true', () => {
    expect(hasImageMarkers(`본문 ${makeImageMarker('https://example.com/a.jpg')} 계속`)).toBe(true);
  });

  it('마커가 없으면 전체가 텍스트 조각 하나', () => {
    const segments = parseBodyWithImageMarkers('그냥 평범한 글이에요');
    expect(segments).toEqual([{ type: 'text', value: '그냥 평범한 글이에요' }]);
  });

  it('텍스트 사이에 낀 이미지 마커를 순서대로(텍스트-이미지-텍스트) 쪼갠다', () => {
    const body = `첫 문단\n${makeImageMarker('https://example.com/a.jpg')}\n둘째 문단`;
    expect(parseBodyWithImageMarkers(body)).toEqual([
      { type: 'text', value: '첫 문단' },
      { type: 'image', url: 'https://example.com/a.jpg' },
      { type: 'text', value: '둘째 문단' },
    ]);
  });

  it('연속된 이미지 마커 여러 개를 전부 뽑는다(이미지 한 장 제한 없음)', () => {
    const body = [makeImageMarker('https://example.com/1.jpg'), makeImageMarker('https://example.com/2.jpg'), makeImageMarker('https://example.com/3.jpg')].join(
      '\n',
    );
    const segments = parseBodyWithImageMarkers(body);
    expect(segments.filter((s) => s.type === 'image')).toHaveLength(3);
    expect(segments.map((s) => (s.type === 'image' ? s.url : null))).toEqual([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
    ]);
  });

  it('본문이 마커로만 끝나면 뒤쪽 빈 텍스트 조각을 안 만든다', () => {
    const body = `설명\n${makeImageMarker('https://example.com/a.jpg')}`;
    const segments = parseBodyWithImageMarkers(body);
    expect(segments).toEqual([
      { type: 'text', value: '설명' },
      { type: 'image', url: 'https://example.com/a.jpg' },
    ]);
  });
});

// 🔒 사용자 발견(2026-08, "글, 영상, 글, 미디어, 영상 이런식으로
// 수정했었는데 또 고낭났어. 글쓰기와 글 내용수정 둘다 같은 기능이어야해") —
// 이미지 마커뿐 아니라 "줄 전체가 URL인" 줄도 독립 세그먼트로 뽑아내는
// 다중 미디어 파서. 예전엔 본문 전체에서 딱 하나의 링크만 감지했다.
describe('parseBodySegments / hasStandaloneMediaLine', () => {
  it('마커도 독립 링크 줄도 없으면 전체가 텍스트 조각 하나', () => {
    expect(parseBodySegments('그냥 평범한 글이에요')).toEqual([{ type: 'text', value: '그냥 평범한 글이에요' }]);
    expect(hasStandaloneMediaLine('그냥 평범한 글이에요')).toBe(false);
  });

  it('문장 중간에 낀 링크는 독립 세그먼트로 안 잡는다(레거시 폴백 대상)', () => {
    const body = '오늘 이거 https://example.com/a 봤어요';
    expect(parseBodySegments(body)).toEqual([{ type: 'text', value: body }]);
    expect(hasStandaloneMediaLine(body)).toBe(false);
  });

  it('줄 전체가 URL 하나뿐이면 독립 link 세그먼트로 뽑는다', () => {
    const body = '글1\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n글2';
    const segments = parseBodySegments(body);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: 'text', value: '글1' });
    expect(segments[1].type).toBe('link');
    expect(segments[1].type === 'link' && segments[1].link.youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(segments[2]).toEqual({ type: 'text', value: '글2' });
    expect(hasStandaloneMediaLine(body)).toBe(true);
  });

  it('글-영상-글-이미지-영상 순서를 그대로 보존한다', () => {
    const body = [
      '첫 텍스트',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      '둘째 텍스트',
      makeImageMarker('https://example.com/a.jpg'),
      'https://example.com/video.mp4',
    ].join('\n');
    const segments = parseBodySegments(body);
    expect(segments.map((s) => s.type)).toEqual(['text', 'link', 'text', 'image', 'link']);
    expect(segments[0]).toEqual({ type: 'text', value: '첫 텍스트' });
    expect(segments[2]).toEqual({ type: 'text', value: '둘째 텍스트' });
    expect(segments[3]).toEqual({ type: 'image', url: 'https://example.com/a.jpg' });
    expect(segments[4].type === 'link' && segments[4].link.isDirectVideo).toBe(true);
  });

  it('연속된 링크 줄 여러 개를 전부 뽑는다', () => {
    const body = ['https://example.com/a.mp4', 'https://example.com/b.mp4'].join('\n');
    const segments = parseBodySegments(body);
    expect(segments.map((s) => s.type)).toEqual(['link', 'link']);
  });

  it('이미지 마커가 있으면 hasStandaloneMediaLine=true(독립 링크 줄이 없어도)', () => {
    expect(hasStandaloneMediaLine(`설명 ${makeImageMarker('https://example.com/a.jpg')}`)).toBe(true);
  });
});

// 🔒 사용자 발견(2026-09-07, "외부 글 긁어온 글, 리스트에서 이미지가 안
// 보여. 글 내용에서는 잘 나와") — feed.ts/market.ts의 bodyPreview가
// body.slice(0, N)로 글자 수만 세서 잘랐다가 이미지 마커·URL 한가운데를
// 잘라 리스트 카드에서만 미리보기가 깨졌던 버그.
describe('truncatePreview', () => {
  it('body가 maxLength 이하면 그대로 반환한다', () => {
    expect(truncatePreview('짧은 글', 300)).toBe('짧은 글');
  });

  it('cutoff가 이미 단어 경계(공백)면 그대로 자른다(잘릴 단어가 없으니 늘릴 필요 없음)', () => {
    expect(truncatePreview('가나다 라마바 사아자', 7)).toBe('가나다 라마바');
  });

  it('🔒 실제 버그 재현 — 독립 링크 줄이 cutoff 한가운데 걸리면 앞으로 더 읽어서 URL을 통째로 완성한다', () => {
    const url = 'https://static.inven.co.kr/column/2026/09/07/article-that-is-quite-long';
    const body = `짧은 설명\n${url}`;
    const cutoff = body.indexOf(url) + 10; // URL 한가운데서 끊기는 길이
    const result = truncatePreview(body, cutoff);
    expect(result.endsWith(url)).toBe(true); // 잘린 채로 버려지지 않고 URL이 통째로 남는다
    expect(detectFirstLink(result)?.url).toBe(url); // 그래서 프론트가 정상적인 링크로 인식할 수 있다
  });

  it('cutoff 뒤에 마저 완성할 텍스트가 더 있으면 그 공백까지만 포함한다(무한정 안 늘어남)', () => {
    const body = '앞부분입니다 다음링크는 https://example.com/a 뒤에 더 이어지는 문장입니다';
    const cutoff = body.indexOf('https://example.com/a') + 10;
    const result = truncatePreview(body, cutoff);
    expect(result).toBe('앞부분입니다 다음링크는 https://example.com/a');
  });

  it('TRUNCATE_LOOKAHEAD 안에서 끝나는 공백을 못 찾으면(비정상적으로 긴 토큰) 통째로 버린다', () => {
    const longToken = 'a'.repeat(600); // 500자 lookahead보다 긴 단일 토큰
    const body = `짧은 설명 ${longToken}`;
    const result = truncatePreview(body, body.indexOf(longToken) + 10);
    expect(result).toBe('짧은 설명'); // 깨진 조각 대신 토큰 전체를 버린다
  });

  it('lookahead를 넘어서도 공백이 전혀 없으면(폴백에서도 자를 지점이 없는 극단적 경우) 어쩔 수 없이 그대로 자른다', () => {
    const longWord = 'a'.repeat(700); // maxLength(10) + TRUNCATE_LOOKAHEAD(500)보다 긺 — 앞뒤 어디에도 공백이 없다
    expect(truncatePreview(longWord, 10)).toBe(longWord.slice(0, 10));
  });
});
