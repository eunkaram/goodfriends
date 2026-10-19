import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { detectFirstLink } from '../lib/link-detect.ts';

/**
 * 문단 전체가 URL 하나뿐이고(=parseBodySegments가 "독립 링크 줄"로 인정할
 * 조건과 동일) 커서가 더 이상 그 문단 안에 없으면(=사용자가 그 줄을 다
 * 쓰고 다음으로 넘어갔다는 뜻) 그 문단을 실제 임베드
 * 노드(composerLinkPreview)로 바꾼다.
 *
 * 🔒 사용자 지시(2026-08, "글, 영상, 글, 미디어, 영상 이런식으로
 * 수정했었는데 또 고낭났어. 글쓰기와 글 내용수정 둘다 같은 기능이어야해") —
 * 이미지는 업로드 버튼/붙여넣기 시점에 즉시 노드로 삽입되지만, 텍스트로
 * 타이핑한 링크는 "다 쓴 뒤"에야 그게 완결된 URL인지 알 수 있다 —
 * 그래서 composer-image-extension.ts처럼 삽입 시점에 바로 만들지 않고,
 * ProseMirror의 표준 appendTransaction 패턴(composer-trailing-paragraph.ts와
 * 같은 방식)으로 "문서가 바뀔 때마다 이 불변식을 검사"하는 쪽을 골랐다.
 *
 * 커서가 아직 그 문단 안에 있으면 절대 건드리지 않는다 — 그렇지 않으면
 * "https://you"까지만 쳤는데 조기 변환을 시도하거나(무해하지만 불필요한
 * 재계산), 링크 뒤에 마저 텍스트를 이어 쓰려던 사용자를 방해하게 된다.
 * Enter로 다음 줄로 넘어가는 순간(가장 흔한 트리거) 자연스럽게 전환된다.
 *
 * ⚠️ 알려진 한계: Enter 없이 URL만 딱 치고 클릭으로 포커스를 옮기는
 * 경우(도큐먼트 변경이 없는 순수 selection 변경)는 이 트랜잭션이 안
 * 도는 selection-only 이벤트라 즉시 전환되지 않는다 — 하지만 저장 형식
 * 자체는 이 노드로 바뀌었는지와 무관하게 항상 plain text 한 줄로
 * 저장되므로(docToBody), 발행 결과나 "글 수정"으로 다시 열었을 때는
 * bodyToDoc이 새로 판정해 정상적으로 임베드로 보인다 — 라이브 편집
 * 화면에서만 한 박자 늦게 보일 수 있는 순수 프레젠테이션 한계다.
 */
export const LinkAutoConvert = Extension.create({
  name: 'linkAutoConvert',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkAutoConvert'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { doc, schema, selection } = newState;
          const linkType = schema.nodes.composerLinkPreview;
          if (!linkType) return null;

          const toConvert: { pos: number; size: number; url: string }[] = [];
          doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return true;
            const nodeEnd = pos + node.nodeSize;
            if (selection.from >= pos && selection.from <= nodeEnd) return false; // 아직 편집 중인 문단 — 건드리지 않는다
            const text = node.textContent.trim();
            if (!text) return false;
            const link = detectFirstLink(text);
            if (link && link.url === text) toConvert.push({ pos, size: node.nodeSize, url: link.url });
            return false;
          });
          if (toConvert.length === 0) return null;

          const tr = newState.tr;
          // 뒤에서부터 치환해야 앞쪽에서 바뀐 오프셋이 뒤쪽 pos를 밀어내지 않는다.
          for (const { pos, size, url } of toConvert.reverse()) {
            const mappedPos = tr.mapping.map(pos);
            const mappedEnd = tr.mapping.map(pos + size);
            tr.replaceWith(mappedPos, mappedEnd, linkType.create({ url }));
          }
          return tr;
        },
      }),
    ];
  },
});
