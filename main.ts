// main.ts is mend, the CLI SPEC.md specifies: one patch tool for every AI edit format
// (unified diff, SEARCH/REPLACE blocks, V4A patches, JSON edits). It reads a patch, finds
// the lines each edit names at the first of three matching tiers (exact, trailing
// whitespace, leading and trailing whitespace), and writes every change or none.
// Node 22, the standard library alone; run it as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this
// file hands over to runner.ts (the last lines below): keep that hand-over and runner.ts
// as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** A file as lines: its line break, its lines, and whether it ends with a line break. */
interface FileText {
  lines: string[];
  br: string;
  final: boolean;
}

function splitFile(text: string): FileText {
  if (text === '') return { lines: [], br: '\n', final: false };
  const nl = text.indexOf('\n');
  const br = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { lines: parts, br, final };
}

function joinFile(f: FileText): string {
  if (f.lines.length === 0) return '';
  return f.lines.join(f.br) + (f.final ? f.br : '');
}

const leadingWs = (s: string): string => (s.match(/^[ \t]*/) ?? [''])[0]!;
const stripTrail = (s: string): string => s.replace(/[ \t]+$/, '');
const stripBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

function lineEq(a: string, b: string, tier: number): boolean {
  if (tier === 0) return a === b;
  if (tier === 1) return stripTrail(a) === stripTrail(b);
  return stripBoth(a) === stripBoth(b);
}

/** Every 0-based position where O occurs in lines at this tier (overlaps count). */
function occurrences(lines: string[], o: string[], tier: number): number[] {
  const out: number[] = [];
  if (o.length === 0 || o.length > lines.length) return out;
  for (let i = 0; i + o.length <= lines.length; i++) {
    let ok = true;
    for (let j = 0; j < o.length; j++) {
      if (!lineEq(lines[i + j]!, o[j]!, tier)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** The first tier (0, 1, 2; or 0 only when strict) at which O occurs at or after `from`. */
function findMatch(lines: string[], o: string[], strict: boolean, from: number): { tier: number; positions: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const positions = occurrences(lines, o, tier).filter((p) => p >= from);
    if (positions.length > 0) return { tier, positions };
  }
  return null;
}

/** The first line at or after `from` equal to a single-line anchor at the first tier with one. */
function findAnchor(lines: string[], anchor: string, strict: boolean, from: number): number | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    for (let i = from; i < lines.length; i++) {
      if (lineEq(lines[i]!, anchor, tier)) return i;
    }
  }
  return null;
}

/** One line of N: a context line (written as the file's own matched line) or a new line. */
interface NewLine {
  ctx: boolean;
  oIndex: number;
  text: string;
}

/** N written over the match at pos: context lines from the file, other lines re-indented at tier 2. */
function buildNew(n: NewLine[], fileLines: string[], pos: number, o: string[], tier: number): string[] {
  const out: string[] = [];
  const f = o.length > 0 ? leadingWs(fileLines[pos]!) : '';
  const p = o.length > 0 ? leadingWs(o[0]!) : '';
  for (const el of n) {
    if (el.ctx) {
      out.push(fileLines[pos + el.oIndex]!);
      continue;
    }
    let t = el.text;
    if (tier === 2 && o.length > 0 && t !== '' && t.trim() !== '' && t.startsWith(p)) t = f + t.slice(p.length);
    out.push(t);
  }
  return out;
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  readonly moves: Array<[string, string]> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/* ---- Unified diffs (SPEC.md section 6) ---- */

interface Op {
  kind: 'ctx' | 'old' | 'new' | 'bs';
  text: string;
}
interface UnifiedHunk {
  a: number;
  ops: Op[];
}
interface UnifiedSection {
  oldPath: string | null;
  newPath: string | null;
  newFile: boolean;
  deletedFile: boolean;
  hunks: UnifiedHunk[];
}

/** A `--- `/`+++ ` path: text after the four characters, up to the first tab, trimmed, one a/ or b/ removed. */
function pairPath(line: string): string | null {
  let p = line.slice(4);
  const tab = p.indexOf('\t');
  if (tab >= 0) p = p.slice(0, tab);
  p = p.trim();
  if (p.startsWith('a/')) p = p.slice(2);
  else if (p.startsWith('b/')) p = p.slice(2);
  if (p === '/dev/null') return null;
  return p;
}

function parseUnified(lines: string[]): UnifiedSection[] {
  const sections: UnifiedSection[] = [];
  let cur: UnifiedSection | null = null;
  let hasPair = false;
  let inHunks = false;
  const push = (): void => {
    if (cur !== null) sections.push(cur);
    cur = null;
    hasPair = false;
    inHunks = false;
  };
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const rest = line.slice('diff --git '.length);
      if (!rest.startsWith('a/')) throw new Exit2(`error: parse ${i + 1}`);
      const sep = rest.indexOf(' b/', 2);
      if (sep < 0) throw new Exit2(`error: parse ${i + 1}`);
      const x = rest.slice(2, sep);
      const y = rest.slice(sep + 3);
      if (x === '' || y === '') throw new Exit2(`error: parse ${i + 1}`);
      push();
      cur = { oldPath: x, newPath: y, newFile: false, deletedFile: false, hunks: [] };
      i += 1;
      continue;
    }
    if (line.startsWith('--- ')) {
      const next = lines[i + 1];
      if (next !== undefined && next.startsWith('+++ ')) {
        if (cur !== null && !inHunks && !hasPair) {
          cur.oldPath = pairPath(line);
          cur.newPath = pairPath(next);
          hasPair = true;
        } else {
          push();
          cur = { oldPath: pairPath(line), newPath: pairPath(next), newFile: false, deletedFile: false, hunks: [] };
          hasPair = true;
        }
        i += 2;
        continue;
      }
      if (cur !== null && !inHunks && !hasPair) throw new Exit2(`error: parse ${i + 2}`);
      i += 1;
      continue;
    }
    if (line.startsWith('+++ ') && cur !== null && !inHunks && !hasPair) {
      cur.newPath = pairPath(line);
      i += 1;
      continue;
    }
    if (cur !== null && !inHunks) {
      if (line.startsWith('rename from ')) {
        if (!hasPair) cur.oldPath = line.slice('rename from '.length).trim();
        i += 1;
        continue;
      }
      if (line.startsWith('rename to ')) {
        if (!hasPair) cur.newPath = line.slice('rename to '.length).trim();
        i += 1;
        continue;
      }
      if (line.startsWith('new file mode')) {
        cur.newFile = true;
        i += 1;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        cur.deletedFile = true;
        i += 1;
        continue;
      }
    }
    if (line.startsWith('@@')) {
      const m = hunkRe.exec(line);
      if (m === null || cur === null) throw new Exit2(`error: parse ${i + 1}`);
      const ops: Op[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const bl = lines[j]!;
        if (bl.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
        if (bl === '') ops.push({ kind: 'ctx', text: '' });
        else if (bl[0] === ' ') ops.push({ kind: 'ctx', text: bl.slice(1) });
        else if (bl[0] === '-') ops.push({ kind: 'old', text: bl.slice(1) });
        else if (bl[0] === '+') ops.push({ kind: 'new', text: bl.slice(1) });
        else if (bl[0] === '\\') ops.push({ kind: 'bs', text: '' });
        else break;
        j += 1;
      }
      while (ops.length > 0) {
        const last = ops[ops.length - 1]!;
        if (last.kind === 'ctx' && last.text.trim() === '') ops.pop();
        else break;
      }
      cur.hunks.push({ a: Number(m[1]), ops });
      inHunks = true;
      i = j;
      continue;
    }
    i += 1;
  }
  push();
  return sections;
}

/** O (context and old lines) and N (context lines carry their O index, new lines their text). */
function splitOps(ops: Op[]): { o: string[]; n: NewLine[] } {
  const o: string[] = [];
  const n: NewLine[] = [];
  for (const op of ops) {
    if (op.kind === 'ctx') {
      n.push({ ctx: true, oIndex: o.length, text: op.text });
      o.push(op.text);
    } else if (op.kind === 'old') {
      o.push(op.text);
    } else if (op.kind === 'new') {
      n.push({ ctx: false, oIndex: -1, text: op.text });
    }
  }
  return { o, n };
}

/** Whether a `\` line follows the hunk's last context or `+` line (false when it has none). */
function backslashAfterLastCtxOrNew(ops: Op[]): boolean {
  for (let k = ops.length - 1; k >= 0; k--) {
    const op = ops[k]!;
    if (op.kind === 'ctx' || op.kind === 'new') return ops[k + 1]?.kind === 'bs';
  }
  return false;
}

/** Whether a `\` line follows the hunk's last `+` line (false when it has none). */
function backslashAfterLastNew(ops: Op[]): boolean {
  for (let k = ops.length - 1; k >= 0; k--) {
    const op = ops[k]!;
    if (op.kind === 'new') return ops[k + 1]?.kind === 'bs';
  }
  return false;
}

/** A section's hunks applied in order to a file's text (the file's own line break is kept). */
function applyUnifiedHunks(text: string, hunks: UnifiedHunk[], strict: boolean, path: string): string {
  let fl = splitFile(text);
  let d = 0;
  for (const h of hunks) {
    const { o, n } = splitOps(h.ops);
    if (o.length > 0) {
      const m = findMatch(fl.lines, o, strict, 0);
      if (m === null) throw new Fail('no-match', path);
      const target = h.a - 1 + d;
      let best = m.positions[0]!;
      for (const pos of m.positions) {
        if (Math.abs(pos - target) < Math.abs(best - target)) best = pos;
      }
      const atEnd = best + o.length === fl.lines.length;
      const repl = buildNew(n, fl.lines, best, o, m.tier);
      const lines = [...fl.lines.slice(0, best), ...repl, ...fl.lines.slice(best + o.length)];
      const fin = atEnd ? !backslashAfterLastCtxOrNew(h.ops) : fl.final;
      fl = { lines, br: fl.br, final: fin };
      d += n.length - o.length;
    } else {
      const at = Math.min(h.a + d, fl.lines.length);
      const repl = buildNew(n, fl.lines, at, o, 0);
      const lines = [...fl.lines.slice(0, at), ...repl, ...fl.lines.slice(at)];
      const fin = at === fl.lines.length ? !backslashAfterLastCtxOrNew(h.ops) : fl.final;
      fl = { lines, br: fl.br, final: fin };
      d += n.length;
    }
  }
  return joinFile(fl);
}

function unifiedEdit(sec: UnifiedSection, strict: boolean): Edit {
  return (tree) => {
    const oldP = sec.oldPath;
    const newP = sec.newPath;
    if (oldP === null && newP === null) throw new Fail('unsafe', '');
    const isCreate = (oldP === null || sec.newFile) && newP !== null;
    const isDelete = !isCreate && (newP === null || sec.deletedFile) && oldP !== null;
    if (isCreate) {
      const p = newP!;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      const plus: string[] = [];
      let lastPlusHunk: UnifiedHunk | null = null;
      for (const h of sec.hunks) {
        let hasNew = false;
        for (const op of h.ops) {
          if (op.kind === 'new') {
            plus.push(op.text);
            hasNew = true;
          }
        }
        if (hasNew) lastPlusHunk = h;
      }
      const text = plus.length === 0 ? '' : plus.join('\n') + (lastPlusHunk !== null && backslashAfterLastNew(lastPlusHunk.ops) ? '' : '\n');
      tree.now.set(p, text);
      return;
    }
    if (isDelete) {
      const p = oldP!;
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    const isMove = oldP !== null && newP !== null && oldP !== newP;
    const p = oldP!;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (isMove && !safe(newP!)) throw new Fail('unsafe', newP!);
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    if (isMove && tree.get(newP!) !== null) throw new Fail('exists', newP!);
    const out = applyUnifiedHunks(before, sec.hunks, strict, p);
    if (isMove) {
      tree.now.set(p, null);
      tree.now.set(newP!, out);
      tree.moves.push([p, newP!]);
    } else {
      tree.now.set(p, out);
    }
  };
}

/* ---- SEARCH/REPLACE blocks (SPEC.md section 7) ---- */

interface SrBlock {
  path: string;
  oldLines: string[];
  newLines: string[];
}

function parseSearchReplace(lines: string[]): SrBlock[] {
  const blocks: SrBlock[] = [];
  let prevEnd = -1;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i += 1;
      continue;
    }
    let path: string | null = null;
    for (let j = i - 1; j > prevEnd; j--) {
      const l = lines[j]!;
      if (blank(l)) continue;
      if (l.trim().startsWith('```')) continue;
      path = l.trim();
      break;
    }
    if (path === null) {
      if (blocks.length > 0) path = blocks[blocks.length - 1]!.path;
      else throw new Exit2(`error: parse ${i + 1}`);
    }
    let sep = -1;
    let k = i + 1;
    for (; k < lines.length; k++) {
      const t = lines[k]!.trimEnd();
      if (t === '=======') {
        sep = k;
        break;
      }
      if (t === '>>>>>>> REPLACE' || t === '<<<<<<< SEARCH') break;
    }
    if (sep < 0) throw new Exit2(`error: parse ${i + 1}`);
    let end = -1;
    for (k = sep + 1; k < lines.length; k++) {
      if (lines[k]!.trimEnd() === '>>>>>>> REPLACE') {
        end = k;
        break;
      }
    }
    if (end < 0) throw new Exit2(`error: parse ${i + 1}`);
    blocks.push({ path, oldLines: lines.slice(i + 1, sep), newLines: lines.slice(sep + 1, end) });
    prevEnd = end;
    i = end + 1;
  }
  return blocks;
}

function srEdit(b: SrBlock, strict: boolean): Edit {
  return (tree) => {
    const p = b.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (b.oldLines.length === 0) {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, b.newLines.length === 0 ? '' : b.newLines.join('\n') + '\n');
      return;
    }
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    const fl = splitFile(before);
    const m = findMatch(fl.lines, b.oldLines, strict, 0);
    if (m === null) throw new Fail('no-match', p);
    if (m.positions.length > 1) throw new Fail('ambiguous', p);
    const pos = m.positions[0]!;
    const n: NewLine[] = b.newLines.map((t) => ({ ctx: false, oIndex: -1, text: t }));
    const repl = buildNew(n, fl.lines, pos, b.oldLines, m.tier);
    const lines = [...fl.lines.slice(0, pos), ...repl, ...fl.lines.slice(pos + b.oldLines.length)];
    tree.now.set(p, joinFile({ lines, br: fl.br, final: fl.final }));
  };
}

/* ---- V4A patches (SPEC.md section 8) ---- */

interface V4aChunk {
  anchor: string | null;
  ops: Op[];
  eof: boolean;
}
interface V4aSection {
  kind: 'add' | 'delete' | 'update';
  path: string;
  moveTo: string | null;
  lines: string[];
  chunks: V4aChunk[];
  headerLine: number;
}

function v4aBodyOp(l: string): Op {
  if (l === '') return { kind: 'ctx', text: '' };
  if (l[0] === ' ') return { kind: 'ctx', text: l.slice(1) };
  if (l[0] === '-') return { kind: 'old', text: l.slice(1) };
  return { kind: 'new', text: l.slice(1) };
}

function parseV4a(lines: string[]): V4aSection[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!blank(lines[i]!)) {
      last = i;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const sections: V4aSection[] = [];
  const isBody = (l: string): boolean => l === '' || l[0] === ' ' || l[0] === '-' || l[0] === '+';
  let i = first + 1;
  while (i < last) {
    while (i < last && blank(lines[i]!)) i += 1;
    if (i >= last) break;
    const line = lines[i]!;
    let kind: 'add' | 'delete' | 'update' | null = null;
    let path = '';
    if (line.startsWith('*** Add File: ')) {
      kind = 'add';
      path = line.slice('*** Add File: '.length).trim();
    } else if (line.startsWith('*** Delete File: ')) {
      kind = 'delete';
      path = line.slice('*** Delete File: '.length).trim();
    } else if (line.startsWith('*** Update File: ')) {
      kind = 'update';
      path = line.slice('*** Update File: '.length).trim();
    } else {
      throw new Exit2(`error: parse ${i + 1}`);
    }
    const headerLine = i + 1;
    const content: number[] = [];
    let j = i + 1;
    while (j < last) {
      const l = lines[j]!;
      if (l.startsWith('*** Add File: ') || l.startsWith('*** Delete File: ') || l.startsWith('*** Update File: ')) break;
      content.push(j);
      j += 1;
    }
    while (content.length > 0 && blank(lines[content[content.length - 1]!]!)) content.pop();
    if (kind === 'add') {
      const fileLines: string[] = [];
      for (const idx of content) {
        const l = lines[idx]!;
        if (l === '') fileLines.push('');
        else if (l.startsWith('+')) fileLines.push(l.slice(1));
        else throw new Exit2(`error: parse ${idx + 1}`);
      }
      sections.push({ kind, path, moveTo: null, lines: fileLines, chunks: [], headerLine });
    } else if (kind === 'delete') {
      if (content.length > 0) throw new Exit2(`error: parse ${content[0]! + 1}`);
      sections.push({ kind, path, moveTo: null, lines: [], chunks: [], headerLine });
    } else {
      let moveTo: string | null = null;
      let k = 0;
      if (k < content.length && lines[content[k]!]!.startsWith('*** Move to: ')) {
        moveTo = lines[content[k]!]!.slice('*** Move to: '.length).trim();
        k += 1;
      }
      const chunks: V4aChunk[] = [];
      let cur: V4aChunk | null = null;
      while (k < content.length) {
        const idx = content[k]!;
        const l = lines[idx]!;
        if (l.startsWith('@@')) {
          const anchor = l.slice(2).trim();
          cur = { anchor: anchor === '' ? null : anchor, ops: [], eof: false };
          chunks.push(cur);
          k += 1;
          while (k < content.length) {
            const bl = lines[content[k]!]!;
            if (!isBody(bl)) break;
            cur.ops.push(v4aBodyOp(bl));
            k += 1;
          }
          continue;
        }
        if (l === '*** End of File') {
          if (cur === null) throw new Exit2(`error: parse ${idx + 1}`);
          cur.eof = true;
          cur = null;
          k += 1;
          continue;
        }
        if (cur === null && chunks.length === 0 && isBody(l)) {
          cur = { anchor: null, ops: [], eof: false };
          chunks.push(cur);
          while (k < content.length) {
            const bl = lines[content[k]!]!;
            if (!isBody(bl)) break;
            cur.ops.push(v4aBodyOp(bl));
            k += 1;
          }
          continue;
        }
        throw new Exit2(`error: parse ${idx + 1}`);
      }
      if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${headerLine}`);
      sections.push({ kind, path, moveTo, lines: [], chunks, headerLine });
    }
    i = j;
  }
  return sections;
}

function v4aEdit(sec: V4aSection, strict: boolean): Edit {
  return (tree) => {
    const p = sec.path;
    if (!safe(p)) throw new Fail('unsafe', p);
    if (sec.kind === 'add') {
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, sec.lines.length === 0 ? '' : sec.lines.join('\n') + '\n');
      return;
    }
    if (sec.kind === 'delete') {
      if (tree.get(p) === null) throw new Fail('missing', p);
      tree.now.set(p, null);
      return;
    }
    if (sec.moveTo !== null && !safe(sec.moveTo)) throw new Fail('unsafe', sec.moveTo);
    const before = tree.get(p);
    if (before === null) throw new Fail('missing', p);
    if (sec.moveTo !== null && tree.get(sec.moveTo) !== null) throw new Fail('exists', sec.moveTo);
    const fl = splitFile(before);
    let lines = fl.lines;
    let cursor = 0;
    for (const ch of sec.chunks) {
      if (ch.anchor !== null) {
        const apos = findAnchor(lines, ch.anchor, strict, cursor);
        if (apos === null) throw new Fail('no-match', p);
        cursor = apos + 1;
      }
      const { o, n } = splitOps(ch.ops);
      if (o.length > 0) {
        const m = findMatch(lines, o, strict, cursor);
        if (m === null) throw new Fail('no-match', p);
        let pos: number | null = null;
        for (const q of m.positions) {
          if (ch.eof && q + o.length !== lines.length) continue;
          pos = q;
          break;
        }
        if (pos === null) throw new Fail('no-match', p);
        const repl = buildNew(n, lines, pos, o, m.tier);
        lines = [...lines.slice(0, pos), ...repl, ...lines.slice(pos + o.length)];
        cursor = pos + repl.length;
      } else {
        const at = ch.eof ? lines.length : cursor;
        const repl = buildNew(n, lines, at, o, 0);
        lines = [...lines.slice(0, at), ...repl, ...lines.slice(at)];
        cursor = at + repl.length;
      }
    }
    const out = joinFile({ lines, br: fl.br, final: fl.final });
    if (sec.moveTo !== null) {
      tree.now.set(p, null);
      tree.now.set(sec.moveTo, out);
      tree.moves.push([p, sec.moveTo]);
    } else {
      tree.now.set(p, out);
    }
  };
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    if (kind === 'json') edits = jsonEdits(text, lines);
    else if (kind === 'unified') edits = parseUnified(lines).map((s) => unifiedEdit(s, strict));
    else if (kind === 'search-replace') edits = parseSearchReplace(lines).map((b) => srEdit(b, strict));
    else edits = parseV4a(lines).map((s) => v4aEdit(s, strict));
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const beforeMoves = tree.moves.length;
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.length = beforeMoves;
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const rows: Array<{ key: string; text: string }> = [];
  const rOld = new Set<string>();
  const rNew = new Set<string>();
  for (const [oldP, newP] of tree.moves) {
    if (tree.original(oldP) !== null && tree.now.get(oldP) === null && tree.original(newP) === null && tree.now.get(newP) !== null) {
      rows.push({ key: newP, text: `R ${oldP} -> ${newP}` });
      rOld.add(oldP);
      rNew.add(newP);
    }
  }
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    if (rOld.has(p) || rNew.has(p)) continue;
    rows.push({ key: p, text: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()]) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  return { code: 0, out: [...rows.map((r) => r.text), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
