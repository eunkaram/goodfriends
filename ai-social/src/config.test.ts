import { describe, it, expect } from 'vitest';
import { config } from './config.js';

describe('대시보드 서버 설정', () => {
  it('127.0.0.1에만 바인드한다', () => {
    expect(config.server.host).toBe('127.0.0.1');
  });
  it('기본 포트는 3013이다', () => {
    if (!process.env.PORT) expect(config.server.port).toBe(3013);
  });
});
