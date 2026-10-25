/**
 * Media — 이미지 업로드(§13 북키핑). `media` 테이블(0020_media.sql)과
 * `POST /api/media/upload`를 부르는 프론트(ProfileEditModal.tsx·
 * PostComposerModal.tsx·CommentSection.tsx) 쪽은 2026-08부터 이미 있었는데,
 * 정작 이 라우트를 받는 백엔드 파일이 한 번도 만들어진 적이 없었다(실전
 * 발견, 2026-10 — "developed 서비스를 모두 파악... 버그 다 수정해줘").
 *
 * 🔒 원래 설계(PostComposerModal.tsx 주석 "§17.3 인프라, R2")는 Cloudflare
 * R2 같은 오브젝트 스토리지였지만, R2 자격증명이 .env/.env.example 어디에도
 * 없고 AWS SDK 등 클라이언트도 설치돼 있지 않다 — 실제로 존재하지 않는
 * 외부 인프라를 전제로 코드를 짤 수 없다(이 프로젝트 전반의 "실제로 없는
 * 사실은 지어내지 않는다" 원칙과 같은 이유, lib/static-pages.ts 참고). 지금
 * 당장 실제로 동작하게 만드는 게 목적이라 로컬 디스크(backend/uploads/)에
 * 저장하고 이 프로세스가 직접 서빙한다 — 나중에 진짜 R2를 쓰게 되면
 * saveUpload() 내부 구현만 바꾸면 되고, 호출부(media-http.ts)와 반환
 * 계약({ url })은 그대로 유지된다.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appPool, withRelationCtx } from './db.ts';

// web/components/{CommentSection,PostComposerModal,ProfileEditModal}.tsx의
// ALLOWED_IMAGE_MIME과 동일 — 프론트가 이미 이 네 개만 골라 보내지만,
// 백엔드가 유일한 신뢰 경계라 여기서도 그대로 검증한다.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB — 프로필 사진·댓글 첨부 넉넉히 커버

// import.meta.url 기준으로 고정 — CWD가 어디서 `node src/server.ts`를
// 실행하든(npm script·테스트 러너 등) 항상 backend/uploads/를 가리킨다.
const UPLOAD_DIR = fileURLToPath(new URL('../uploads/', import.meta.url));

const pool = appPool('exists');

export type MediaUploadResult = { ok: true; url: string } | { ok: false; error: 'INVALID_MIME' | 'TOO_LARGE' };

/** 🔒 생성한 key(randomUUID+확장자)만 통과하는 화이트리스트 — GET 핸들러가
 * 이 형식을 요구하므로 경로 조작(`../../etc/passwd` 등)이 애초에 불가능하다. */
const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;

export async function saveUpload(userId: string, mimeType: string, buffer: Buffer, publicOrigin: string): Promise<MediaUploadResult> {
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) return { ok: false, error: 'INVALID_MIME' };
  if (buffer.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: 'TOO_LARGE' };

  const key = `${randomUUID()}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, key), buffer);
  const url = `${publicOrigin}/media/${key}`;

  // 🔒 media 테이블은 북키핑 전용(0020 주석 — "업로더 식별·용량 집계 목적").
  // 이 INSERT가 실패해도 파일은 이미 저장돼 반환할 URL은 유효하다 — 그래도
  // 집계가 틀어지면 안 되니 실패를 삼키지 않고 그대로 던진다(server.ts의
  // 공용 500 처리로 위임).
  await withRelationCtx(pool, { userId }, (client) =>
    client.query(`INSERT INTO media (owner_id, storage_key, public_url, mime_type, bytes) VALUES ($1, $2, $3, $4, $5)`, [
      userId,
      key,
      url,
      mimeType,
      buffer.byteLength,
    ]),
  );

  return { ok: true, url };
}

/** 🔒 migration 0020 주석과 동일한 전제 — 공개 오브젝트라 인증 없이 그대로
 * 서빙한다(media 테이블 자체는 RLS로 본인 것만 보이지만, 이 함수는 그
 * 테이블을 거치지 않고 디스크에서 바로 읽는다 — 댓글·게시물 본문에 박힌
 * URL은 누가 올렸든 브라우저가 직접 열 수 있어야 하므로 의도적으로 그렇다). */
export async function readMediaFile(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!KEY_RE.test(key)) return null;
  const ext = key.slice(key.lastIndexOf('.') + 1);
  try {
    const buffer = await readFile(join(UPLOAD_DIR, key));
    return { buffer, contentType: MIME_BY_EXT[ext] };
  } catch {
    return null;
  }
}
