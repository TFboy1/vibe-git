import type { TaskChangeContent } from "@vibe-git/protocol";

export function normalizeTaskContent(value: TaskChangeContent): TaskChangeContent {
  return { goal: value.goal.trim(), boundary: value.boundary.trim(), acceptance: value.acceptance.map(item => item.trim()).filter(Boolean) };
}
export function taskContentChanged(before: TaskChangeContent, after: TaskChangeContent): boolean {
  return before.goal !== after.goal || before.boundary !== after.boundary || JSON.stringify(before.acceptance) !== JSON.stringify(after.acceptance);
}

type Part = { text: string; changed: boolean };
type DiffLine = { number: number; text: string; changed: boolean; parts: Part[] };
type DiffRow = { before: DiffLine | null; after: DiffLine | null };
function diffText(before: string, after: string): { before: Part[]; after: Part[] } {
  const left = Array.from(before), right = Array.from(after);
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const a = left.slice(start, left.length - end), b = right.slice(start, right.length - end);
  const result: { before: Part[]; after: Part[] } = { before: [], after: [] };
  const append = (parts: Part[], value: string, changed: boolean) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.changed === changed) last.text += value;
    else parts.push({ text: value, changed });
  };
  const unchanged = (value: string) => { append(result.before, value, false); append(result.after, value, false); };
  unchanged(left.slice(0, start).join(""));
  // 长文本限制矩阵大小，仍完整展示差异，避免编辑时阻塞页面。
  if (!a.length || !b.length || a.length * b.length > 250_000) {
    append(result.before, a.join(""), true); append(result.after, b.join(""), true);
  } else {
    const width = b.length + 1, lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { unchanged(a[i]!); i++; j++; }
      else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) append(result.before, a[i++]!, true);
      else append(result.after, b[j++]!, true);
    }
  }
  unchanged(end ? left.slice(left.length - end).join("") : "");
  return result;
}

function diffLines(before: string, after: string): DiffRow[] {
  const left = before ? before.split(/\r?\n/) : [], right = after ? after.split(/\r?\n/) : [];
  const rows: DiffRow[] = [], removed: DiffLine[] = [], added: DiffLine[] = [];
  const line = (text: string, number: number, changed: boolean): DiffLine => ({ text, number, changed, parts: [{ text, changed }] });
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      const beforeLine = removed[i] ?? null, afterLine = added[i] ?? null;
      if (beforeLine && afterLine) {
        const parts = diffText(beforeLine.text, afterLine.text);
        beforeLine.parts = parts.before; afterLine.parts = parts.after;
      }
      rows.push({ before: beforeLine, after: afterLine });
    }
    removed.length = 0; added.length = 0;
  };
  const same = (i: number, j: number) => {
    flush(); rows.push({ before: line(left[i]!, i + 1, false), after: line(right[j]!, j + 1, false) });
  };
  let start = 0, end = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) { same(start, start); start++; }
  while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end++;
  const leftEnd = left.length - end, rightEnd = right.length - end;
  const height = leftEnd - start, width = rightEnd - start;
  // 先按行对齐，再在替换行中标出字级变化。长文本限制矩阵大小。
  if (!height || !width || height * width > 250_000) {
    for (let i = start; i < leftEnd; i++) removed.push(line(left[i]!, i + 1, true));
    for (let j = start; j < rightEnd; j++) added.push(line(right[j]!, j + 1, true));
  } else {
    const stride = width + 1, lengths = new Uint32Array((height + 1) * stride);
    for (let i = height - 1; i >= 0; i--) for (let j = width - 1; j >= 0; j--) {
      lengths[i * stride + j] = left[start + i] === right[start + j] ? lengths[(i + 1) * stride + j + 1]! + 1 : Math.max(lengths[(i + 1) * stride + j]!, lengths[i * stride + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < height || j < width) {
      if (i < height && j < width && left[start + i] === right[start + j]) { same(start + i, start + j); i++; j++; }
      else if (i < height && (j === width || lengths[(i + 1) * stride + j]! >= lengths[i * stride + j + 1]!)) { removed.push(line(left[start + i]!, start + i + 1, true)); i++; }
      else { added.push(line(right[start + j]!, start + j + 1, true)); j++; }
    }
  }
  flush();
  for (let i = 0; i < end; i++) same(leftEnd + i, rightEnd + i);
  return rows;
}

function DiffCells({ line, side }: { line: DiffLine | null; side: "before" | "after" }) {
  const state = !line ? "gap" : line.changed ? side === "before" ? "removed" : "added" : "context";
  const className = `wb-diff-cell wb-diff-cell--${state}`;
  return <>
    <td className={`${className} wb-diff-number`}>{line?.number}</td>
    <td className={`${className} wb-diff-sign`} aria-hidden="true">{line?.changed ? side === "before" ? "−" : "+" : ""}</td>
    <td className={`${className} wb-diff-code${side === "before" ? " wb-diff-divider" : ""}`}>{line ? line.parts.length ? line.parts.map((part, i) => part.changed ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>) : "\u00a0" : "\u00a0"}</td>
  </>;
}

export function ContentChangeDiff({ fields, beforeLabel = "原任务", afterLabel = "待发布任务" }: {
  fields: Array<{ label: string; before: string; after: string }>; beforeLabel?: string; afterLabel?: string;
}) {
  return <div className="wb-task-diff" role="region" aria-label="任务左右差异对比" tabIndex={0}>
    <table className="wb-split-diff">
      <caption className="wb-sr-only">左侧为{beforeLabel}，右侧为{afterLabel}。减号表示删除，加号表示新增，红色标记修改内容。</caption>
      <colgroup><col className="wb-diff-gutter" /><col className="wb-diff-symbol" /><col /><col className="wb-diff-gutter" /><col className="wb-diff-symbol" /><col /></colgroup>
      <thead><tr><th colSpan={3} className="wb-diff-divider">{beforeLabel}</th><th colSpan={3}>{afterLabel}</th></tr></thead>
      {fields.map(field => {
        const rows = diffLines(field.before, field.after);
        const removed = rows.filter(row => row.before?.changed).length, added = rows.filter(row => row.after?.changed).length;
        return <tbody key={field.label}>
          <tr className="wb-diff-section"><th colSpan={3} className="wb-diff-divider">{field.label}{removed > 0 && <span>−{removed}</span>}</th><th colSpan={3}>{field.label}{added > 0 ? <span>+{added}</span> : removed === 0 && <small>未修改</small>}</th></tr>
          {rows.length ? rows.map((row, i) => <tr key={i}><DiffCells line={row.before} side="before" /><DiffCells line={row.after} side="after" /></tr>) : <tr><td colSpan={3} className="wb-diff-empty wb-diff-divider">（空）</td><td colSpan={3} className="wb-diff-empty">（空）</td></tr>}
        </tbody>;
      })}
    </table>
  </div>;
}

export function TaskChangeDiff({ before, after, beforeLabel, afterLabel }: {
  before: TaskChangeContent; after: TaskChangeContent; beforeLabel?: string; afterLabel?: string;
}) {
  return <ContentChangeDiff fields={[
    { label: "目标", before: before.goal, after: after.goal },
    { label: "职责边界", before: before.boundary, after: after.boundary },
    { label: "验收条件", before: before.acceptance.map(item => `• ${item}`).join("\n"), after: after.acceptance.map(item => `• ${item}`).join("\n") }
  ]} {...(beforeLabel ? { beforeLabel } : {})} {...(afterLabel ? { afterLabel } : {})} />;
}
