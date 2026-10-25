import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection } from '@tiptap/pm/state';

/**
 * 문서 맨 끝이 텍스트를 담을 수 없는 노드(이미지 atom 등)로 끝나면 그
 * 뒤에 빈 문단을 자동으로 붙이고, 커서도 그 문단 안으로 옮긴다.
 * ProseMirror의 표준 "trailing node" 패턴 — appendTransaction으로 매
 * 트랜잭션 뒤에 이 불변식을 강제한다.
 *
 * 🔒 실전 버그(실브라우저 검증 중 발견, 2단계로 진단) — 이미지가 문서
 * 맨 끝에 삽입되면 그 뒤에 커서가 들어갈 textblock이 없어서
 * ProseMirror의 선택이 NodeSelection(이미지 자체를 선택한 상태)으로
 * 남는다. 이 상태에서 다음 글자를 타이핑하면 선택된 노드가 통째로
 * 지워지고 그 글자로 치환된다. 파일 업로드(PostComposerModal.tsx의
 * insertFiles)뿐 아니라 클립보드 HTML 붙여넣기(ComposerImage.parseHTML —
 * Tiptap이 내부적으로 처리해 그 경로엔 우리 코드가 개입할 지점이 없다)도
 * 똑같이 겪는다 — 진입점마다 따로 패치하는 대신 이 플러그인 하나로
 * 막는다. ⚠️ 1차 시도는 빈 문단만 추가했는데 그것만으론 부족했다 —
 * NodeSelection 자체는 "지금 선택된 게 이미지 노드"라는 뜻이라, 문단을
 * 만들어줘도 선택을 그 안으로 직접 옮기지 않으면 타이핑은 여전히 그
 * NodeSelection을 치환해버린다. 그래서 트리거 조건이 "직전 선택이 정확히
 * 이 마지막 노드를 가리키는 NodeSelection이었을 때"로 좁혀져 있다 — 문서
 * 어딘가 다른 곳(예: 이미 안정적으로 있던 이미지와 무관한 위치)을 사용자가
 * 명시적으로 선택해둔 상태까지 건드리지 않기 위해서다.
 */
export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { doc, schema } = newState;
          const last = doc.lastChild;
          if (!last || last.isTextblock) return null;
          const paragraph = schema.nodes.paragraph;
          if (!paragraph) return null;

          const lastPos = doc.content.size - last.nodeSize;
          const sel = newState.selection;
          const shouldMoveInto = sel instanceof NodeSelection && sel.from === lastPos;

          const tr = newState.tr.insert(doc.content.size, paragraph.create());
          if (shouldMoveInto) {
            tr.setSelection(TextSelection.create(tr.doc, doc.content.size + 1));
          }
          return tr;
        },
      }),
    ];
  },
});
