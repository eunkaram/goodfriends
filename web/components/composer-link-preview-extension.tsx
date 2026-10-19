import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { detectFirstLink } from '../lib/link-detect.ts';
import { LinkPreviewCard } from './LinkPreviewCard.tsx';
import styles from './HomeFeed.module.css';

/**
 * WYSIWYG 컴포저 전용 링크 미리보기 노드(사용자 지시, 2026-08 — "글, 영상,
 * 글, 미디어, 영상 이런식으로 수정했었는데 또 고낭났어. 글쓰기와 글
 * 내용수정 둘다 같은 기능이어야해"). ComposerImage(이미지 업로드)와 같은
 * atom:true 패턴이지만, 이건 업로드가 아니라 "본문에 이미 있는 URL 한
 * 줄"을 실제 임베드(유튜브 iframe·mp4 플레이어·OG 카드 등)로 그자리에서
 * 바로 보여준다 — LinkPreviewCard를 그대로 재사용해서 발행된 글·피드
 * 카드가 쓰는 렌더링과 완전히 동일한 결과를 편집 중에도 보여준다.
 *
 * 저장 형식은 안 바뀐다 — docToBody가 이 노드를 만나면 그냥 attrs.url을
 * plain text 한 줄로 되돌린다(마커 아님, ComposerImage와 다른 점). 반대로
 * bodyToDoc은 "줄 전체가 URL 하나뿐인" 줄을 이 노드로 되돌린다(src/link-
 * detect.ts의 parseBodySegments와 같은 판정 규칙) — 그래서 새 글쓰기든
 * 기존 글 수정이든 항상 같은 화면을 본다.
 */
export type ComposerLinkPreviewAttrs = { url: string };

function ComposerLinkPreviewView({ node, selected, deleteNode }: ReactNodeViewProps) {
  const url = node.attrs.url as string;
  const link = detectFirstLink(url) ?? {
    url,
    youtubeVideoId: null,
    isYoutubeShorts: false,
    isDirectImage: false,
    isDirectVideo: false,
    isHlsVideo: false,
  };

  return (
    <NodeViewWrapper as="div" className={selected ? `${styles.composerLinkPreviewNode} ${styles.composerLinkPreviewSelected}` : styles.composerLinkPreviewNode}>
      <LinkPreviewCard
        url={link.url}
        youtubeVideoId={link.youtubeVideoId}
        isYoutubeShorts={link.isYoutubeShorts}
        isDirectImage={link.isDirectImage}
        isDirectVideo={link.isDirectVideo}
        isHlsVideo={link.isHlsVideo}
        compact
      />
      {/* 🔒 이미지 노드(ComposerImage)는 선택 후 Backspace로 지우는 것 외엔
          제거 수단이 없다 — 링크 미리보기도 같은 select+delete UX를
          기본으로 두되, 실패한 OG/이미지 미리보기(LinkPreviewCard가
          null을 반환해 시각적으로 빈 자리가 될 수 있다)를 손으로도 바로
          지울 수 있게 작은 × 버튼을 얹었다(atom 노드라 클릭 시 자동으로
          선택되지만, 실패해 빈 자리면 클릭할 대상 자체가 없어 선택조차
          안 될 수 있어서). */}
      <button type="button" className={styles.composerLinkPreviewRemove} onClick={deleteNode} aria-label="링크 미리보기 제거" title="제거">
        ×
      </button>
    </NodeViewWrapper>
  );
}

export const ComposerLinkPreview = Node.create({
  name: 'composerLinkPreview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // renderHTML을 직접 지정해 항상 data-url 하나로만 왕복시킨다 —
      // 기본값(속성명 그대로 url=)에 맡기면 parseHTML의 data-url 조회와
      // 어긋난다.
      url: { default: '', renderHTML: (attrs) => ({ 'data-url': attrs.url }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-composer-link-preview]', getAttrs: (el) => ({ url: (el as HTMLElement).getAttribute('data-url') ?? '' }) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-composer-link-preview': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ComposerLinkPreviewView);
  },
});
