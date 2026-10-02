import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import C2GateBlock from '@/components/common/C2GateBlock.vue';
import C3ReasonedButton from '@/components/common/C3ReasonedButton.vue';
import C4ReferenceNotice from '@/components/common/C4ReferenceNotice.vue';
import StatusBadge from '@/components/common/StatusBadge.vue';
import { useGates } from '@/stores/gates';

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] });

describe('게이트 컴포넌트 (FR-004 ~ FR-006 · FR-100)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const g = useGates();
    g.defs = {
      G6: { gateCode: 'G6', gateName: '판정 가능', blockMessage: '자료가 부족해 판정할 수 없습니다', releaseParty: '기록한 시설관리자' },
    };
    g.loaded = true;
  });

  it('C2 첫 줄 = gate_def 문구, 닫기 버튼 없음, 타인 해제 안내', () => {
    const w = mount(C2GateBlock, {
      props: {
        block: {
          gate: 'G6',
          message: '서버 문구',
          releaseParty: 'x',
          selfRelease: false,
          actions: [{ id: 'request', label: '추가 자료 요청 보내기' }],
        },
      },
      global: { plugins: [router] },
    });
    expect(w.find('.gate-title').text()).toContain('자료가 부족해 판정할 수 없습니다');
    expect(w.text()).toContain('기록한 시설관리자의 확인이 필요해요');
    expect(w.text()).toContain('요청을 보내면');
    expect(w.findAll('button').map((b) => b.text())).not.toContain('닫기');
  });

  it('C3 비활성 사유 = C2 첫 줄과 같은 문자열, 포커스 가능(aria-disabled)', () => {
    const w = mount(C3ReasonedButton, { props: { disabled: true, gate: 'G6' }, slots: { default: '검증 완료' } });
    const btn = w.find('button');
    expect(btn.attributes('disabled')).toBeUndefined();
    expect(btn.attributes('aria-disabled')).toBe('true');
    expect(w.find('.why').text()).toBe('자료가 부족해 판정할 수 없습니다');
    expect(btn.attributes('aria-describedby')).toBe(w.find('.why').attributes('id'));
  });

  it('C3 비활성 클릭은 이벤트를 내지 않는다', async () => {
    const w = mount(C3ReasonedButton, { props: { disabled: true, reason: '사진을 올려 주세요' } });
    await w.find('button').trigger('click');
    expect(w.emitted('click')).toBeUndefined();
  });

  it('C4 고지에는 닫기·접기 요소가 없다', () => {
    const w = mount(C4ReferenceNotice, { props: { notice: { noticeId: 1, body: '이미지 기반 1차 참고용 정보' } } });
    expect(w.find('button').exists()).toBe(false);
    expect(w.text()).toContain('1차 참고용');
    expect(w.text()).toContain('고지 판본 #1');
  });

  it.each([
    ['ok', '●'],
    ['warn', '▲'],
    ['danger', '■'],
    ['na', '–'],
  ] as const)('StatusBadge %s 는 글자·형태 동시 표현', (tone, shape) => {
    const w = mount(StatusBadge, { props: { tone, label: '상태' } });
    expect(w.text()).toContain(shape);
    expect(w.text()).toContain('상태');
  });
});
