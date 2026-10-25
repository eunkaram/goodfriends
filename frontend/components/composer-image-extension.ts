import { Node, mergeAttributes } from '@tiptap/core';

/**
 * WYSIWYG 컴포저 전용 이미지 노드(사용자 지시, 2026-08 — "wysiwyg editor
 * 같은 입력폼을 원해"). atom:true라 커서가 노드 내부로 못 들어가고
 * 통째로 선택·삭제된다.
 *
 * 저장 형식은 안 바뀐다 — 제출/직렬화 시점에 이 노드를 순회해 기존 마커
 * 포맷(SOH+IMG:+url, lib/link-detect.ts)으로 되돌린다(PostComposerModal.tsx의
 * docToBody). DB·다른 화면(피드 카드·포스트 상세)이 소비하는 형식은 전혀
 * 안 바뀐다 — 이 노드는 컴포저 안에서만 존재하는 편집 전용 표현이다.
 *
 * `status`는 'uploading'|'done' — 업로드 중엔 data-status로 렌더링해서
 * CSS로 옅게 보여준다(uploadingCount 계산에도 쓰인다, PostComposerModal.tsx
 * 참고). `uploadId`는 비동기 업로드가 완료·실패했을 때 어느 노드를
 * 갱신·삭제할지 찾기 위한 키다 — 위치(pos)는 편집 중 계속 바뀌므로
 * 위치가 아니라 이 안정적인 id로 문서를 순회해 찾는다(ProseMirror의
 * 표준 패턴).
 */
export type ComposerImageAttrs = {
  src: string;
  uploadId: string | null;
  status: 'uploading' | 'done';
};

const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src', 'data-lazy'];

/**
 * 예전 paste-html-to-text.ts의 resolveImgSrc와 동일한 검증 — 지연 로딩
 * 속성 폴백, data: URI(거대한 base64 임베드 방지)·상대경로(clipboard엔
 * origin 정보가 없어 못 푼다) 거부.
 */
function resolveImgSrc(el: Element): string | null {
  let src = el.getAttribute('src') ?? '';
  if (!src || src.startsWith('data:')) {
    for (const attr of LAZY_SRC_ATTRS) {
      const v = el.getAttribute(attr);
      if (v) {
        src = v;
        break;
      }
    }
  }
  if (!src || src.startsWith('data:')) return null;
  if (!/^(https?:)?\/\//i.test(src)) return null;
  return src.startsWith('//') ? `https:${src}` : src;
}

export const ComposerImage = Node.create({
  name: 'composerImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: null },
      uploadId: { default: null, renderHTML: () => ({}) },
      status: {
        default: 'done',
        renderHTML: (attrs) => ({ 'data-status': attrs.status }),
      },
    };
  },

  // 🔒 붙여넣기(뉴스·갤러리 페이지에서 긁어온 <img>) — 임의 <img> 태그를
  // 매칭해서 이 노드로 파싱한다. getAttrs가 false를 반환하면(검증 실패)
  // 이 규칙이 매치 자체를 안 한 것으로 취급돼 Tiptap이 기본 처리(텍스트만
  // 남김)로 폴백한다.
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const src = resolveImgSrc(el);
          if (!src) return false;
          return { src, status: 'done', uploadId: null };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'composerImageNode' })];
  },
});
