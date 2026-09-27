import { describe, expect, it } from 'vitest';
import { defaultMixChoices, MAX_MIX_CELLS, planMix, renderMix } from '../mix';

/** 把分段压成便于断言的形式：'=' 文本 / diff(A 文本|B 文本) */
function outline(plan: ReturnType<typeof planMix>): string[] {
  return plan.segments.map((s) =>
    s.kind === 'equal' ? `=${s.text}` : `(${s.aText}|${s.bText})[${s.choiceIndex}]`,
  );
}

/** 暴力枚举两条字素序列间的全部最优 LCS 匹配位置序列（用于校验字典序固定规则）。 */
function allLcsMatchSequences(a: string, b: string): Array<Array<[number, number]>> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : 0);
    }
  }
  const out: Array<Array<[number, number]>> = [];
  const cur: Array<[number, number]> = [];
  const walk = (i: number, j: number) => {
    if (i === 0 || j === 0) {
      out.push([...cur].reverse());
      return;
    }
    if (a[i - 1] === b[j - 1] && dp[i - 1][j - 1] + 1 === dp[i][j]) {
      cur.push([i - 1, j - 1]);
      walk(i - 1, j - 1);
      cur.pop();
    }
    if (dp[i - 1][j] === dp[i][j]) walk(i - 1, j);
    if (dp[i][j - 1] === dp[i][j]) walk(i, j - 1);
  };
  walk(n, m);
  const lex = (x: Array<[number, number]>, y: Array<[number, number]>) => {
    for (let k = 0; k < Math.max(x.length, y.length); k++) {
      const xa = x[k]?.[0] ?? Infinity;
      const ya = y[k]?.[0] ?? Infinity;
      if (xa !== ya) return xa - ya;
      const xb = x[k]?.[1] ?? Infinity;
      const yb = y[k]?.[1] ?? Infinity;
      if (xb !== yb) return xb - yb;
    }
    return 0;
  };
  return out.sort(lex);
}

describe('planMix 分段', () => {
  it('相同片段固定、差异片段分段（含单侧插入/删除）', () => {
    const plan = planMix('你好世界', '你好呀世界');
    expect(plan.ok).toBe(true);
    expect(plan.diffCount).toBe(1);
    expect(outline(plan)).toEqual(['=你好', '(|呀)[0]', '=世界']);
    expect(plan.matches).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
      [3, 4],
    ]);
  });

  it('双侧内容不同的连续操作合并为单个差异片段', () => {
    // A: abcX  B: abcY → 公共 abc，尾部 X/Y 为同一段差异
    expect(outline(planMix('abcX', 'abcY'))).toEqual(['=abc', '(X|Y)[0]']);
  });

  it('前缀差异 + 公共 + 后缀差异', () => {
    expect(outline(planMix('甲共同尾', '乙共同巴'))).toEqual([
      '(甲|乙)[0]',
      '=共同',
      '(尾|巴)[1]',
    ]);
  });

  it('完全相同只有一个 equal 片段、无差异段', () => {
    const plan = planMix('一模一样', '一模一样');
    expect(plan.diffCount).toBe(0);
    expect(outline(plan)).toEqual(['=一模一样']);
  });

  it('完全不同为单个双侧差异片段', () => {
    expect(outline(planMix('甲乙', '丙丁'))).toEqual(['(甲乙|丙丁)[0]']);
  });

  it('整段单侧插入 / 删除', () => {
    expect(outline(planMix('abc', 'abcdef'))).toEqual(['=abc', '(|def)[0]']);
    expect(outline(planMix('abcdef', 'abc'))).toEqual(['=abc', '(def|)[0]']);
  });
});

describe('planMix 字典序固定（重复词不漂移）', () => {
  const cases: Array<[string, string]> = [
    ['ab', 'ba'],
    ['xyx', 'yxy'],
    ['aab', 'aba'],
    ['the cat the dog', 'the dog the cat'],
    ['ha ha', 'ha! ha'],
    ['重复 重复 结尾', '重复 结尾 重复'],
  ];
  for (const [a, b] of cases) {
    it(`${JSON.stringify(a)} vs ${JSON.stringify(b)} 取匹配位置先 A 后 B 字典序最小的最优路径`, () => {
      const plan = planMix(a, b);
      const expected = allLcsMatchSequences(a, b)[0];
      expect(plan.matches).toEqual(expected);
    });
  }

  it('结果对重复输入确定：重复计算分段完全一致', () => {
    const a = 'the cat the dog the end';
    const b = 'the dog the cat the end';
    const p1 = planMix(a, b);
    const p2 = planMix(a, b);
    expect(outline(p1)).toEqual(outline(p2));
    expect(p1.matches).toEqual(p2.matches);
  });

  it('重排场景 ab/ba 下边界与匹配位置字典序最小一致（a[0]→b[1]）', () => {
    const plan = planMix('ab', 'ba');
    expect(plan.matches).toEqual([[0, 1]]);
    // B 独有的 b 在前、公共匹配 a 居中、A 独有的 b 在后
    expect(outline(plan)).toEqual(['(|b)[0]', '=a', '(b|)[1]']);
  });
});

describe('planMix 字素', () => {
  it('按 Unicode 字素簇切分：组合音标与 emoji ZWJ 序列作为整体', () => {
    // é = e + 组合重音；家庭 emoji ZWJ 序列为一个字素
    const family = '👨‍👩‍👧';
    const plan = planMix(`${family}尾`, `${family}头`);
    expect(plan.diffCount).toBe(1);
    expect(outline(plan)).toEqual([`=${family}`, '(尾|头)[0]']);
  });

  it('过长文本返回 too-large', () => {
    const a = 'a'.repeat(2000);
    const b = 'a'.repeat(2000);
    expect((a.length + 1) * (b.length + 1)).toBeGreaterThan(MAX_MIX_CELLS);
    const plan = planMix(a, b);
    expect(plan.ok).toBe(false);
    expect(plan.error).toBe('too-large');
  });
});

describe('defaultMixChoices / renderMix', () => {
  it('默认每段取字素更长一侧，平局取 A', () => {
    const plan = planMix('甲长一点 同 尾', '乙 同 尾巴长一点');
    const choices = defaultMixChoices(plan);
    expect(choices).toHaveLength(plan.diffCount);
    // 首段 A 更长取 A；尾段 B 更长取 B
    expect(renderMix(plan, choices)).toBe('甲长一点 同 尾巴长一点');
  });

  it('逐段选择即时生成文本：分别取 A/B/混选', () => {
    const plan = planMix('甲共同尾', '乙共同巴');
    expect(renderMix(plan, ['A', 'A'])).toBe('甲共同尾');
    expect(renderMix(plan, ['B', 'B'])).toBe('乙共同巴');
    expect(renderMix(plan, ['A', 'B'])).toBe('甲共同巴');
    expect(renderMix(plan, ['B', 'A'])).toBe('乙共同尾');
  });

  it('单侧插入/删除段选择后不产生重复或丢失公共部分', () => {
    const inserted = planMix('你好世界', '你好呀世界');
    expect(renderMix(inserted, ['A'])).toBe('你好世界');
    expect(renderMix(inserted, ['B'])).toBe('你好呀世界');
    const deleted = planMix('你好呀世界', '你好世界');
    expect(renderMix(deleted, ['A'])).toBe('你好呀世界');
    expect(renderMix(deleted, ['B'])).toBe('你好世界');
  });

  it('选择缺失/长度不符时按 A 兜底，不抛异常', () => {
    const plan = planMix('甲共同尾', '乙共同巴');
    expect(renderMix(plan, undefined)).toBe('甲共同尾');
    expect(renderMix(plan, ['B'])).toBe('乙共同尾');
  });
});
