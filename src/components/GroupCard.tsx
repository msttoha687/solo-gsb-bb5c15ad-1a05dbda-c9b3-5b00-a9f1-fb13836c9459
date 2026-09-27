import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { AlignGroup, GroupKind } from '../lib/align';
import { mergedText, type GroupState, type Resolution, type TextChoice, type TimeChoice } from '../lib/merge';
import { defaultMixChoices, planMix, renderMix, type MixPlan, type MixSide } from '../lib/mix';
import { formatTimecode, type Cue } from '../lib/srt';

const KIND_LABEL: Record<GroupKind, string> = {
  '1:1': '一对一',
  '1:N': '一对多',
  'N:1': '多对一',
  'A-only': '仅 A',
  'B-only': '仅 B',
};

const KIND_CLS: Record<GroupKind, string> = {
  '1:1': 'k11',
  '1:N': 'k1n',
  'N:1': 'kn1',
  'A-only': 'ka',
  'B-only': 'kb',
};

interface GroupCardProps {
  index: number;
  group: AlignGroup;
  state: GroupState;
  cuesA: Cue[];
  cuesB: Cue[];
  suggestion: TextChoice;
  onResolve(patch: Partial<Resolution>): void;
}

export function GroupCard({ index, group, state, cuesA, cuesB, suggestion, onResolve }: GroupCardProps) {
  const res = state.resolution;
  const matched = group.aIdx.length > 0 && group.bIdx.length > 0;
  const onlySide = group.kind === 'A-only' ? 'A' : 'B';
  const cardCls = state.isConflict ? (state.resolved ? 'resolved' : 'unresolved') : '';

  const textA = useMemo(() => mergedText(cuesA, group.aIdx), [cuesA, group.aIdx]);
  const textB = useMemo(() => mergedText(cuesB, group.bIdx), [cuesB, group.bIdx]);
  const mixPlan: MixPlan = useMemo(
    () => (matched ? planMix(textA, textB) : { ok: false, segments: [], diffCount: 0, matches: [] }),
    [matched, textA, textB],
  );

  // 进入局部混编：按字素 LCS 分段并给出默认逐段选择（每段取更长一侧），即时生成整组文本
  const enterMix = () => {
    if (!mixPlan.ok) return;
    onResolve({ text: 'mix', mixChoices: defaultMixChoices(mixPlan) });
  };

  const pickSegment = (ci: number, side: MixSide) => {
    if (!mixPlan.ok) return;
    const choices =
      res.mixChoices.length === mixPlan.diffCount
        ? res.mixChoices.slice()
        : defaultMixChoices(mixPlan);
    choices[ci] = side;
    onResolve({ mixChoices: choices });
  };

  const pickAllSegments = (side: MixSide) => {
    if (!mixPlan.ok) return;
    onResolve({ mixChoices: mixPlan.segments.filter((s) => s.kind === 'diff').map(() => side) });
  };

  const mixPreview =
    res.text === 'mix' && mixPlan.ok ? renderMix(mixPlan, res.mixChoices) : '';

  return (
    <article className={`group-card ${cardCls}`} id={`group-${index}`}>
      <header className="g-head">
        <span className="g-idx">#{index + 1}</span>
        <span className={`kind ${KIND_CLS[group.kind]}`}>{KIND_LABEL[group.kind]}</span>
        {matched ? (
          <Confidence value={group.confidence} textSim={group.textSim} timeOverlap={group.timeOverlap} />
        ) : (
          <span className="conf-na">无对照</span>
        )}
        {matched && group.confidence < 0.5 && <span className="tag low">低置信</span>}
        <span className="spacer" />
        {state.isConflict &&
          (state.resolved ? <span className="tag ok">✓ 已解决</span> : <span className="tag warn">未解决</span>)}
        {state.isConflict && (
          <button
            className="btn-mini"
            title={`采用建议：文本取版本 ${suggestion}，时间轴取并集`}
            onClick={() => onResolve({ text: suggestion, time: 'union' })}
          >
            采纳建议
          </button>
        )}
      </header>

      <div className="g-cols">
        <CueColumn title="版本 A" cls="a" cues={cuesA} idxs={group.aIdx} />
        <CueColumn title="版本 B" cls="b" cues={cuesB} idxs={group.bIdx} />
      </div>

      {matched ? (
        <div className="g-controls">
          <div className="ctl-row">
            <span className="ctl-label">保留文本</span>
            <Pill value="A" current={res.text} onPick={(v: TextChoice) => onResolve({ text: v })}>
              版本 A
            </Pill>
            <Pill value="B" current={res.text} onPick={(v: TextChoice) => onResolve({ text: v })}>
              版本 B
            </Pill>
            <Pill value="mix" current={res.text} onPick={enterMix} disabled={!mixPlan.ok}>
              局部混编
            </Pill>
            <Pill value="custom" current={res.text} onPick={(v: TextChoice) => onResolve({ text: v })}>
              自定义
            </Pill>
            {!mixPlan.ok && <span className="mix-hint">文本过长，无法局部混编</span>}
          </div>
          {res.text === 'custom' && (
            <textarea
              className="custom-text"
              rows={2}
              placeholder="输入自定义文本…"
              value={res.customText}
              spellCheck={false}
              onChange={(e) => onResolve({ customText: e.target.value })}
            />
          )}
          {res.text === 'mix' && mixPlan.ok && (
            <MixEditor
              plan={mixPlan}
              choices={res.mixChoices}
              preview={mixPreview}
              onPick={pickSegment}
              onPickAll={pickAllSegments}
            />
          )}
          <div className="ctl-row">
            <span className="ctl-label">时间轴</span>
            <Pill value="A" current={res.time} onPick={(v: TimeChoice) => onResolve({ time: v })}>
              版本 A
            </Pill>
            <Pill value="B" current={res.time} onPick={(v: TimeChoice) => onResolve({ time: v })}>
              版本 B
            </Pill>
            <Pill value="union" current={res.time} onPick={(v: TimeChoice) => onResolve({ time: v })}>
              并集
            </Pill>
            <Pill value="custom" current={res.time} onPick={(v: TimeChoice) => onResolve({ time: v })}>
              自定义
            </Pill>
          </div>
          {res.time === 'custom' && (
            <div className="ctl-row custom-time">
              <input
                value={res.customStart}
                placeholder="00:00:01,000"
                spellCheck={false}
                onChange={(e) => onResolve({ customStart: e.target.value })}
              />
              <span className="arrow">→</span>
              <input
                value={res.customEnd}
                placeholder="00:00:03,500"
                spellCheck={false}
                onChange={(e) => onResolve({ customEnd: e.target.value })}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="g-controls">
          <div className="ctl-row">
            <span className="ctl-label">仅存在于版本 {onlySide}</span>
            <Pill value="keep" current={res.keep ? 'keep' : 'drop'} onPick={() => onResolve({ keep: true })}>
              保留
            </Pill>
            <Pill value="drop" current={res.keep ? 'keep' : 'drop'} onPick={() => onResolve({ keep: false })}>
              丢弃
            </Pill>
          </div>
        </div>
      )}
    </article>
  );
}

/** 局部混编编辑器：相同片段固定展示，差异片段逐段选择 A/B，顶部即时预览生成文本。 */
function MixEditor({
  plan,
  choices,
  preview,
  onPick,
  onPickAll,
}: {
  plan: MixPlan;
  choices: readonly MixSide[];
  preview: string;
  onPick(choiceIndex: number, side: MixSide): void;
  onPickAll(side: MixSide): void;
}) {
  const safeChoices: readonly MixSide[] =
    choices.length === plan.diffCount
      ? choices
      : plan.segments.filter((s) => s.kind === 'diff').map(() => 'A' as MixSide);
  return (
    <div className="mix-editor">
      <div className="mix-head">
        <span className="mix-title">局部混编</span>
        <span className="mix-hint">
          相同片段固定保留，{plan.diffCount} 个差异片段逐段选择；按字素最长公共子序列对齐，重复词边界固定
        </span>
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => onPickAll('A')}>
          差异全取 A
        </button>
        <button type="button" className="btn sm" onClick={() => onPickAll('B')}>
          差异全取 B
        </button>
      </div>
      <div className="mix-segments">
        {plan.segments.map((seg, si) =>
          seg.kind === 'equal' ? (
            <span className="mix-seg equal" key={si}>
              {seg.text}
            </span>
          ) : (
            <span className="mix-diff" key={si}>
              <button
                type="button"
                className={`mix-opt a ${safeChoices[seg.choiceIndex] === 'A' ? 'sel' : ''}`}
                title={seg.aText === '' ? '该侧无此片段（删除）' : `取 A：${seg.aText}`}
                onClick={() => onPick(seg.choiceIndex, 'A')}
              >
                <span className="mix-side-tag">A</span>
                <span className="mix-seg-text">{seg.aText === '' ? '∅' : seg.aText}</span>
              </button>
              <button
                type="button"
                className={`mix-opt b ${safeChoices[seg.choiceIndex] === 'B' ? 'sel' : ''}`}
                title={seg.bText === '' ? '该侧无此片段（插入）' : `取 B：${seg.bText}`}
                onClick={() => onPick(seg.choiceIndex, 'B')}
              >
                <span className="mix-side-tag">B</span>
                <span className="mix-seg-text">{seg.bText === '' ? '∅' : seg.bText}</span>
              </button>
            </span>
          ),
        )}
      </div>
      <div className="mix-preview" title="当前逐段选择生成的整组文本（已进入右侧预览与导出）">
        <span className="mix-preview-label">混编结果</span>
        <span className="mix-preview-text">{preview}</span>
      </div>
    </div>
  );
}

function Pill<T extends string>({
  value,
  current,
  onPick,
  children,
  disabled,
}: {
  value: T;
  current: T;
  onPick(v: T): void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`pill ${current === value ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={disabled ? undefined : () => onPick(value)}
    >
      <input type="radio" checked={current === value} readOnly />
      {children}
    </label>
  );
}

function Confidence({ value, textSim, timeOverlap }: { value: number; textSim: number; timeOverlap: number }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.8 ? 'high' : value >= 0.5 ? 'mid' : 'low';
  return (
    <div
      className="conf"
      title={`综合置信度 ${pct}%（文本相似度 ${Math.round(textSim * 100)}%，时间重叠 ${Math.round(timeOverlap * 100)}%）`}
    >
      <div className="conf-track">
        <div className={`conf-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="conf-num">{pct}%</span>
    </div>
  );
}

function CueColumn({ title, cls, cues, idxs }: { title: string; cls: string; cues: Cue[]; idxs: number[] }) {
  return (
    <div className={`cue-col ${cls}`}>
      <div className="cue-col-title">{title}</div>
      {idxs.length === 0 ? (
        <div className="cue-empty">（无对应片段）</div>
      ) : (
        idxs.map((i) => (
          <div className="cue" key={i}>
            <div className="cue-meta">
              <span className="cue-no">#{cues[i].id + 1}</span>
              <span className="cue-time">
                {formatTimecode(cues[i].start)} → {formatTimecode(cues[i].end)}
              </span>
            </div>
            <div className="cue-text">{cues[i].text}</div>
          </div>
        ))
      )}
    </div>
  );
}
