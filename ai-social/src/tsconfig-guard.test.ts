import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('ai-social tsc 프로그램 경계', () => {
  it('tsconfig는 src만 포함하고, src 안의 어떤 파일도 frontend 소스를 import하지 않는다', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf-8'));
    expect(tsconfig.include).toEqual(['src/**/*']);
    const offenders = walk(path.join(root, 'src'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== import.meta.filename)
      .filter((f) => /from\s+['"][^'"]*frontend\//.test(fs.readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
  });
  it('frontend 렌더 계약 테스트는 tsc 밖(contract/)에 있다', () => {
    const root = path.resolve(import.meta.dirname, '..');
    expect(fs.existsSync(path.join(root, 'contract', 'frontend-render.test.ts'))).toBe(true);
  });
});
