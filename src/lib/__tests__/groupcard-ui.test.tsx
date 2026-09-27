import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GroupCard } from '../../components/GroupCard';
import type { AlignGroup } from '../align';
import type { GroupState } from '../merge';
import { parseSrt } from '../srt';

const cuesA = parseSrt('1\n00:00:01,000 --> 00:00:04,000\n你好世界\n');
const cuesB = parseSrt('1\n00:00:01,000 --> 00:00:04,000\n你好呀世界\n');

const g: AlignGroup = {
  id: 'g0',
  aIdx: [0],
  bIdx: [0],
  kind: '1:1',
  textSim: 0.5,
  timeOverlap: 0.8,
  confidence: 0.6,
};

function state(
  patch: Partial<GroupState['resolution']> = {},
  resolved = false,
): GroupState {
  return {
    isConflict: true,
    resolved,
    resolution: {
      text: 'A',
      customText: '',
      time: 'A',
      customStart: '',
      customEnd: '',
      keep: true,
      mixChoices: [],
      ...patch,
    },
  };
}

function render(s: GroupState) {
  return renderToString(
    <GroupCard
      index={0}
      group={g}
      state={s}
      cuesA={cuesA}
      cuesB={cuesB}
      suggestion="B"
      onResolve={vi.fn()}
    />,
  );
}

describe('GroupCard 局部混编', () => {
  it('双侧组提供“局部混编”入口', () => {
    const html = render(state());
    expect(html).toContain('局部混编');
  });

  it('混编状态展示固定片段、差异片段 A/B 与即时混编结果', () => {
    const html = render(state({ text: 'mix', mixChoices: ['B'] }, true));
    // 固定片段与两侧差异候选
    expect(html).toContain('你好');
    expect(html).toContain('世界');
    expect(html).toContain('混编结果');
    expect(html).toContain('你好呀世界');
    // 差异段数提示与批量按钮
    expect(html).toContain('差异全取 A');
    expect(html).toContain('差异全取 B');
  });

  it('差异段取删除侧（A 无“呀”）时混编结果不含插入内容', () => {
    const html = render(state({ text: 'mix', mixChoices: ['A'] }, true));
    expect(html).toContain('>你好世界<');
  });

  it('单边组不展示局部混编', () => {
    const only: AlignGroup = { ...g, aIdx: [0], bIdx: [], kind: 'A-only', confidence: 0 };
    const html = renderToString(
      <GroupCard
        index={0}
        group={only}
        state={state()}
        cuesA={cuesA}
        cuesB={cuesB}
        suggestion="A"
        onResolve={vi.fn()}
      />,
    );
    expect(html).not.toContain('局部混编');
  });
});
