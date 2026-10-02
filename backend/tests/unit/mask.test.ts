import { describe, it, expect } from 'vitest';
import { maskLikeView } from '../../src/lib/mask';

describe('마스킹 (FR-090, v_user_masked 와 같은 규칙)', () => {
  it('이메일·이름·전화', () => {
    expect(maskLikeView({ email: 'kim@example.kr', display_name: '김민준', phone: '010-1234-5678' })).toEqual({
      emailMasked: '***@***.kr',
      nameMasked: '김**',
      phoneMasked: '010-****-5678',
    });
  });
  it('전화 없음', () => {
    expect(maskLikeView({ email: 'a@b.com', display_name: 'A', phone: null }).phoneMasked).toBeNull();
  });
});
