/**
 * 局部混编：把双侧对齐组两侧拼接文本按 Unicode 字素簇求最长公共子序列（LCS），
 * 相同片段（匹配部分）固定保留，差异片段（含单侧插入、删除）逐段选择取 A 或取 B。
 *
 * 多条最优 LCS 路径的固定规则：按【匹配位置先 A 后 B】的字典序取最小者，
 * 即比较由匹配位置 ((i0,j0),(i1,j1),…) 构成的序列，先比 A 下标序列、再比 B 下标序列。
 * 这样在重复词导致多条最优路径时片段边界不会漂移。实现上同时求前向 DP f 与后向 DP g，
 * 从头贪心重建：每个格点只选择仍能取满最优长度的边，优先匹配、再跳过 B、最后跳过 A，
 * 得到唯一的字典序最小最优路径。
 *
 * DP 单元数 (n+1)(m+1) 超过 MAX_MIX_CELLS 时放弃（界面禁用局部混编入口），
 * 避免极端文本造成浏览器卡顿。
 */
import { graphemes } from './wrap';

export type MixSide = 'A' | 'B';

export interface MixSegment {
  /** 'equal' 为 LCS 匹配片段（固定保留）；'diff' 为差异片段，需要逐段选择 */
  kind: 'equal' | 'diff';
  text: string;
  /** diff 片段两侧各自的内容（可能一侧为空字符串，即单侧插入/删除） */
  aText: string;
  bText: string;
  /** diff 片段在选择数组中的下标；equal 片段为 -1 */
  choiceIndex: number;
}

export interface MixPlan {
  ok: boolean;
  /** 文本过长、无法在浏览器内完成全量 LCS DP */
  error?: 'too-large';
  segments: MixSegment[];
  /** 差异片段数量（即选择数组应有长度） */
  diffCount: number;
  /** LCS 匹配位置序列 [(aGraphemeIndex, bGraphemeIndex), …]，顺序与文本一致 */
  matches: Array<[number, number]>;
}

/** DP 单元数上限（(n+1)(m+1)）；前后向两张 Uint32 矩阵，约 16MB 量级。 */
export const MAX_MIX_CELLS = 2_000_000;

/**
 * 计算局部混编分段。两侧文本先按 Unicode 字素簇切分，LCS 相等判定基于字素全等；
 * 连续的同类操作（匹配 / 仅 A / 仅 B）合并为一个片段，差异片段记录其选择下标。
 */
export function planMix(textA: string, textB: string): MixPlan {
  const a = graphemes(textA);
  const b = graphemes(textB);
  const n = a.length;
  const m = b.length;

  if ((n + 1) * (m + 1) > MAX_MIX_CELLS) {
    return { ok: false, error: 'too-large', segments: [], diffCount: 0, matches: [] };
  }

  // 前向 LCS DP：f[i][j] = LCS(a[0..i), b[0..j))（完整矩阵，回溯需要任意单元）
  const W = m + 1;
  let f: Uint32Array;
  try {
    f = new Uint32Array((n + 1) * W);
  } catch {
    return { ok: false, error: 'too-large', segments: [], diffCount: 0, matches: [] };
  }
  for (let i = 1; i <= n; i++) {
    const base = i * W;
    const prev = (i - 1) * W;
    const ga = a[i - 1];
    for (let j = 1; j <= m; j++) {
      let v = f[prev + j];
      const left = f[base + j - 1];
      if (left > v) v = left;
      if (ga === b[j - 1]) {
        const diag = f[prev + j - 1] + 1;
        if (diag > v) v = diag;
      }
      f[base + j] = v;
    }
  }

  // 后向 LCS DP：g[i][j] = LCS(a[i..n), b[j..m))，用于在回溯点判定每条边是否仍属最优路径
  let g: Uint32Array;
  try {
    g = new Uint32Array((n + 1) * W);
  } catch {
    return { ok: false, error: 'too-large', segments: [], diffCount: 0, matches: [] };
  }
  for (let i = n - 1; i >= 0; i--) {
    const base = i * W;
    const next = (i + 1) * W;
    const ga = a[i];
    for (let j = m - 1; j >= 0; j--) {
      let v = g[next + j];
      const right = g[base + j + 1];
      if (right > v) v = right;
      if (ga === b[j]) {
        const diag = g[next + j + 1] + 1;
        if (diag > v) v = diag;
      }
      g[base + j] = v;
    }
  }

  // 贪心重建：在始终保持最优长度 L = f[n][m] 的前提下，
  // ① 当前 (i,j) 可匹配时必须优先匹配（这是让下一个匹配 A 下标最小的选择）；
  // ② 否则能跳过 B（left）就跳过——让当前 A 下标匹配尽可能小的 B 下标；
  // ③ 否则跳过 A（up）。由此唯一确定“匹配位置先 A 后 B”字典序最小路径。
  const ops: Array<'up' | 'left' | 'diag'> = [];
  const matches: Array<[number, number]> = [];
  const L = f[n * W + m];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const canMatch =
      a[i] === b[j] && f[i * W + j] + 1 + g[(i + 1) * W + j + 1] === L;
    if (canMatch) {
      ops.push('diag');
      matches.push([i, j]);
      i++;
      j++;
      continue;
    }
    const canLeft = f[i * W + (j + 1)] + g[i * W + j + 1] === L; // 跳过 B[j]
    if (canLeft) {
      ops.push('left');
      j++;
    } else {
      ops.push('up');
      i++;
    }
  }
  while (i < n) {
    ops.push('up');
    i++;
  }
  while (j < m) {
    ops.push('left');
    j++;
  }

  // 折叠为片段：连续 diag 合并为 equal；连续 up/left（允许交错）合并为一个 diff
  const segments: MixSegment[] = [];
  let diffIndex = 0;
  let pa = 0; // A 字素下标
  let pb = 0; // B 字素下标
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === 'diag') {
      let s = '';
      while (k < ops.length && ops[k] === 'diag') {
        s += a[pa];
        k++;
        pa++;
        pb++;
      }
      segments.push({ kind: 'equal', text: s, aText: s, bText: s, choiceIndex: -1 });
    } else {
      let sa = '';
      let sb = '';
      while (k < ops.length && ops[k] !== 'diag') {
        if (ops[k] === 'up') {
          sa += a[pa];
          pa++;
        } else {
          sb += b[pb];
          pb++;
        }
        k++;
      }
      segments.push({ kind: 'diff', text: '', aText: sa, bText: sb, choiceIndex: diffIndex });
      diffIndex++;
    }
  }

  return { ok: true, segments, diffCount: diffIndex, matches };
}

/** 新进入局部混编时的默认逐段选择：每段取字素数更多的一侧，平局取 A。 */
export function defaultMixChoices(plan: MixPlan): MixSide[] {
  const out: MixSide[] = [];
  for (const seg of plan.segments) {
    if (seg.kind !== 'diff') continue;
    out.push(graphemes(seg.bText).length > graphemes(seg.aText).length ? 'B' : 'A');
  }
  return out;
}

/**
 * 按逐段选择渲染混编文本：equal 片段固定保留，diff 片段按 choices 取对应侧。
 * 选择数组缺失或长度不符时按“默认取 A”兜底，保证任何状态下都能生成文本。
 */
export function renderMix(plan: MixPlan, choices: readonly MixSide[] | undefined): string {
  let out = '';
  for (const seg of plan.segments) {
    if (seg.kind === 'equal') {
      out += seg.text;
      continue;
    }
    const side = choices?.[seg.choiceIndex] ?? 'A';
    out += side === 'B' ? seg.bText : seg.aText;
  }
  return out;
}
