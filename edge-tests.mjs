// Edge-case tests for mend, beyond the practice set: each case hand-computed from SPEC.md.
// Run: node edge-tests.mjs  (from the entry directory; uses ./main.ts)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const MAIN = join(process.cwd(), 'main.ts');
let pass = 0;
let fail = 0;
const failures = [];

function runCase(name, files, argv, stdin, wantExit, wantStdout, wantFiles) {
  const dir = mkdtempSync(join(tmpdir(), 'mend-edge-'));
  try {
    for (const [p, text] of Object.entries(files)) {
      const f = join(dir, ...p.split('/'));
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, text);
    }
    const r = spawnSync(process.execPath, [MAIN, ...argv], { cwd: dir, input: stdin ?? '', encoding: 'utf8', timeout: 10000 });
    const gotExit = r.status;
    const gotStdout = r.stdout ?? '';
    const gotFiles = {};
    const walk = (d, rel) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        const rp = rel ? `${rel}/${n}` : n;
        if (statSync(p).isDirectory()) walk(p, rp);
        else gotFiles[rp] = readFileSync(p, 'utf8');
      }
    };
    walk(dir, '');
    const problems = [];
    if (gotExit !== wantExit) problems.push(`exit ${gotExit} != ${wantExit}`);
    if (gotStdout !== wantStdout) problems.push(`stdout ${JSON.stringify(gotStdout)} != ${JSON.stringify(wantStdout)}`);
    const keys = new Set([...Object.keys(wantFiles), ...Object.keys(gotFiles)]);
    for (const k of keys) {
      if (wantFiles[k] === undefined) problems.push(`unexpected file ${k} = ${JSON.stringify(gotFiles[k])}`);
      else if (gotFiles[k] === undefined) problems.push(`missing file ${k}`);
      else if (gotFiles[k] !== wantFiles[k]) problems.push(`file ${k}: got ${JSON.stringify(gotFiles[k])}, want ${JSON.stringify(wantFiles[k])}`);
    }
    if (problems.length === 0) pass += 1;
    else {
      fail += 1;
      failures.push(`${name}:\n  ${problems.join('\n  ')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- unified ---
runCase('U1 --- without +++ in header', { 'p.diff': 'diff --git a/x.txt b/x.txt\n--- a/x.txt\nfoo\n' }, ['p.diff'], null, 2, 'error: parse 3\n', { 'p.diff': 'diff --git a/x.txt b/x.txt\n--- a/x.txt\nfoo\n' });
runCase('U2 malformed diff --git', { 'p.diff': 'diff --git a/x.txt\n--- a/x.txt\n+++ b/x.txt\n' }, ['p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': 'diff --git a/x.txt\n--- a/x.txt\n+++ b/x.txt\n' });
runCase('U3 hunk before section, auto detect', { 'p.diff': '@@ -1 +1 @@\n+x\n' }, ['p.diff'], null, 2, 'error: format\n', { 'p.diff': '@@ -1 +1 @@\n+x\n' });
runCase('U3b hunk before section, forced unified', { 'p.diff': '@@ -1 +1 @@\n+x\n' }, ['--format=unified', 'p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': '@@ -1 +1 @@\n+x\n' });
runCase(
  'U4 two hunks d offset',
  { 'f.txt': 'a1\na2\na3\nb1\nb2\nb3\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,2 @@\n a1\n-a2\n a3\n@@ -4,3 +3,3 @@\n b1\n-b2\n+B2\n b3\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a1\na3\nb1\nB2\nb3\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,2 @@\n a1\n-a2\n a3\n@@ -4,3 +3,3 @@\n b1\n-b2\n+B2\n b3\n' },
);
runCase(
  'U5a empty-O insert at end, no backslash',
  { 'f.txt': 'a\nb', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,0 +3,1 @@\n+c\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,0 +3,1 @@\n+c\n' },
);
runCase(
  'U5b empty-O insert at end, backslash',
  { 'f.txt': 'a\nb', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,0 +3,1 @@\n+c\n\\ No newline at end of file\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,0 +3,1 @@\n+c\n\\ No newline at end of file\n' },
);
runCase(
  'U6 create with backslash',
  { 'p.diff': '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n' },
  ['p.diff'], null, 0, 'A new.txt\nok: 1 file\n', { 'new.txt': 'one\ntwo', 'p.diff': '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n' },
);
runCase(
  'U7 delete ignores hunks',
  { 'f.txt': 'x\ny\n', 'p.diff': '--- a/f.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-not in file\n-not either\n' },
  ['p.diff'], null, 0, 'D f.txt\nok: 1 file\n', { 'p.diff': '--- a/f.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-not in file\n-not either\n' },
);
runCase(
  'U8 move no hunks',
  { 'f.txt': 'hello\n', 'p.diff': '--- a/f.txt\n+++ b/g.txt\n' },
  ['p.diff'], null, 0, 'R f.txt -> g.txt\nok: 1 file\n', { 'g.txt': 'hello\n', 'p.diff': '--- a/f.txt\n+++ b/g.txt\n' },
);
runCase(
  'U9 rename from/to no pair',
  { 'f.txt': 'hello\n', 'p.diff': 'diff --git a/f.txt b/g.txt\nrename from f.txt\nrename to g.txt\n' },
  ['p.diff'], null, 0, 'R f.txt -> g.txt\nok: 1 file\n', { 'g.txt': 'hello\n', 'p.diff': 'diff --git a/f.txt b/g.txt\nrename from f.txt\nrename to g.txt\n' },
);
runCase(
  'U10 lone +++ names new path',
  { 'f.txt': 'a\nb\n', 'p.diff': 'diff --git a/f.txt b/g.txt\n+++ b/g.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' },
  ['p.diff'], null, 0, 'R f.txt -> g.txt\nok: 1 file\n', { 'g.txt': 'a\nB\n', 'p.diff': 'diff --git a/f.txt b/g.txt\n+++ b/g.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' },
);
runCase(
  'U11 --- path with tab timestamp',
  { 'f.txt': 'a\n', 'p.diff': '--- a/f.txt\t2026-01-01 00:00:00\n+++ b/f.txt\t2026-01-02 00:00:00\n@@ -1 +1 @@\n-a\n+A\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n', 'p.diff': '--- a/f.txt\t2026-01-01 00:00:00\n+++ b/f.txt\t2026-01-02 00:00:00\n@@ -1 +1 @@\n-a\n+A\n' },
);
runCase(
  'U12 insert at top A=0',
  { 'f.txt': 'a\nb\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+top\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'top\na\nb\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+top\n' },
);
runCase(
  'U13 overlapping occurrences nearest',
  { 'f.txt': 'x\nx\nx\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,2 +2,2 @@\n x\n-x\n+X\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'x\nx\nX\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -2,2 +2,2 @@\n x\n-x\n+X\n' },
);
runCase(
  'U14 unsafe path',
  { 'p.diff': '--- a/../evil.txt\n+++ b/../evil.txt\n@@ -1 +1 @@\n-a\n+b\n' },
  ['p.diff'], null, 1, 'error: unsafe ../evil.txt\nfailed: 1 of 1 edits\n', { 'p.diff': '--- a/../evil.txt\n+++ b/../evil.txt\n@@ -1 +1 @@\n-a\n+b\n' },
);
runCase(
  'U15a create exists',
  { 'f.txt': 'x\n', 'p.diff': '--- /dev/null\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+y\n' },
  ['p.diff'], null, 1, 'error: exists f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'x\n', 'p.diff': '--- /dev/null\n+++ b/f.txt\n@@ -0,0 +1,1 @@\n+y\n' },
);
runCase(
  'U15b move to exists',
  { 'f.txt': 'x\n', 'g.txt': 'y\n', 'p.diff': '--- a/f.txt\n+++ b/g.txt\n' },
  ['p.diff'], null, 1, 'error: exists g.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'x\n', 'g.txt': 'y\n', 'p.diff': '--- a/f.txt\n+++ b/g.txt\n' },
);
runCase(
  'U15c change missing',
  { 'p.diff': '--- a/no.txt\n+++ b/no.txt\n@@ -1 +1 @@\n-a\n+b\n' },
  ['p.diff'], null, 1, 'error: missing no.txt\nfailed: 1 of 1 edits\n', { 'p.diff': '--- a/no.txt\n+++ b/no.txt\n@@ -1 +1 @@\n-a\n+b\n' },
);
runCase(
  'U16 two failures reported in order',
  { 'p.diff': '--- a/no1.txt\n+++ b/no1.txt\n@@ -1 +1 @@\n-a\n+b\n--- a/no2.txt\n+++ b/no2.txt\n@@ -1 +1 @@\n-a\n+b\n' },
  ['p.diff'], null, 1, 'error: missing no1.txt\nerror: missing no2.txt\nfailed: 2 of 2 edits\n', { 'p.diff': '--- a/no1.txt\n+++ b/no1.txt\n@@ -1 +1 @@\n-a\n+b\n--- a/no2.txt\n+++ b/no2.txt\n@@ -1 +1 @@\n-a\n+b\n' },
);
runCase(
  'U17 create then modify same file',
  { 'p.diff': '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+one\n--- a/n.txt\n+++ b/n.txt\n@@ -1 +1 @@\n-one\n+two\n' },
  ['p.diff'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'two\n', 'p.diff': '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+one\n--- a/n.txt\n+++ b/n.txt\n@@ -1 +1 @@\n-one\n+two\n' },
);
runCase(
  'U18 first fails second succeeds, nothing written',
  { 'g.txt': 'g\n', 'p.diff': '--- a/no.txt\n+++ b/no.txt\n@@ -1 +1 @@\n-a\n+b\n--- a/g.txt\n+++ b/g.txt\n@@ -1 +1 @@\n-g\n+G\n' },
  ['p.diff'], null, 1, 'error: missing no.txt\nfailed: 1 of 2 edits\n', { 'g.txt': 'g\n', 'p.diff': '--- a/no.txt\n+++ b/no.txt\n@@ -1 +1 @@\n-a\n+b\n--- a/g.txt\n+++ b/g.txt\n@@ -1 +1 @@\n-g\n+G\n' },
);
runCase(
  'U19 --check success writes nothing',
  { 'f.txt': 'a\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' },
  ['--check', 'p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' },
);
runCase(
  'U20 --strict tier1 fails',
  { 'f.txt': 'a \n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' },
  ['--strict', 'p.diff'], null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a \n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' },
);
runCase(
  'U21 no trailing NL hunk not at end stays',
  { 'f.txt': 'a\nb\nc', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nB\nc', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n' },
);
runCase(
  'U22 backslash after minus only, final break true',
  { 'f.txt': 'a\nb', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,1 @@\n a\n-b\n\\ No newline at end of file\n' },
);
runCase('U23 --format=unified prose only', { 'p.diff': 'just some prose\nno edits here\n' }, ['--format=unified', 'p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': 'just some prose\nno edits here\n' });
runCase('U24a two positionals', {}, ['a.diff', 'b.diff'], null, 2, 'error: usage\n', {});
runCase('U24b --check twice', {}, ['--check', '--check', 'p.diff'], null, 2, 'error: usage\n', {});
runCase('U24c bad format value', {}, ['--format=git', 'p.diff'], null, 2, 'error: usage\n', {});
runCase('U24d unknown option', {}, ['--dry-run', 'p.diff'], null, 2, 'error: usage\n', {});
runCase(
  'U25 R sorts by new path',
  { 'a.txt': 'a\n', 'm.txt': 'm\n', 'p.diff': '--- a/m.txt\n+++ b/z.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+A\n' },
  ['p.diff'], null, 0, 'M a.txt\nR m.txt -> z.txt\nok: 2 files\n', { 'a.txt': 'A\n', 'z.txt': 'm\n', 'p.diff': '--- a/m.txt\n+++ b/z.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+A\n' },
);
runCase(
  'U26 CRLF hunk at end with backslash',
  { 'f.txt': 'a\r\nb', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\r\nB', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\\ No newline at end of file\n' },
);
runCase(
  'U27 all-minus hunk at end no trailing NL',
  { 'f.txt': 'a\nb\nc', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -3,1 +2,0 @@\n-c\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -3,1 +2,0 @@\n-c\n' },
);

// --- search/replace ---
runCase('S1 no path first block', { 'p.diff': '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' }, ['p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': '<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' });
runCase(
  'S2 empty old empty new creates empty',
  { 'p.diff': 'n.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': '', 'p.diff': 'n.txt\n<<<<<<< SEARCH\n=======\n>>>>>>> REPLACE\n' },
);
runCase(
  'S3 ambiguous at tier 1',
  { 'f.txt': 'a \na \n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 1, 'error: ambiguous f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a \na \n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
);
runCase(
  'S4 tier2 re-indent SR',
  { 'f.txt': 'def f():\n    x = 1\n    y = 2\n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\nx = 1\n=======\nx = 9\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'def f():\n    x = 9\n    y = 2\n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\nx = 1\n=======\nx = 9\n>>>>>>> REPLACE\n' },
);
runCase(
  'S5 ======= trailing spaces',
  { 'f.txt': 'a\n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\na\n=======   \nb\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'b\n', 'p.diff': 'f.txt\n<<<<<<< SEARCH\na\n=======   \nb\n>>>>>>> REPLACE\n' },
);
runCase(
  'S6 path surrounding spaces trimmed',
  { 'f.txt': 'a\n', 'p.diff': '   f.txt   \n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'b\n', 'p.diff': '   f.txt   \n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n' },
);
runCase(
  'S7 SR create then modify, path reuse',
  { 'p.diff': 'n.txt\n<<<<<<< SEARCH\n=======\none\n>>>>>>> REPLACE\n<<<<<<< SEARCH\none\n=======\ntwo\n>>>>>>> REPLACE\n' },
  ['p.diff'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'two\n', 'p.diff': 'n.txt\n<<<<<<< SEARCH\n=======\none\n>>>>>>> REPLACE\n<<<<<<< SEARCH\none\n=======\ntwo\n>>>>>>> REPLACE\n' },
);
runCase('S8 leading-space SEARCH not a block', { 'p.diff': '  <<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' }, ['--format=search-replace', 'p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': '  <<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n' });

// --- v4a ---
runCase('V1 missing Begin, auto detect', { 'p.diff': '*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' }, ['p.diff'], null, 2, 'error: format\n', { 'p.diff': '*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' });
runCase('V1b missing Begin, forced v4a', { 'p.diff': '*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' }, ['--format=v4a', 'p.diff'], null, 2, 'error: parse 1\n', { 'p.diff': '*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' });
runCase('V2 missing End', { 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n' }, ['p.diff'], null, 2, 'error: parse 6\n', { 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n' });
runCase(
  'V3 Add trailing blanks stripped',
  { 'p.diff': '*** Begin Patch\n*** Add File: n.txt\n+one\n+two\n\n\n*** End Patch\n' },
  ['p.diff'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'one\ntwo\n', 'p.diff': '*** Begin Patch\n*** Add File: n.txt\n+one\n+two\n\n\n*** End Patch\n' },
);
runCase('V4 Add bad line', { 'p.diff': '*** Begin Patch\n*** Add File: n.txt\n+one\nplain\n*** End Patch\n' }, ['p.diff'], null, 2, 'error: parse 4\n', { 'p.diff': '*** Begin Patch\n*** Add File: n.txt\n+one\nplain\n*** End Patch\n' });
runCase('V5 Delete with a line', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Delete File: f.txt\n+oops\n*** End Patch\n' }, ['p.diff'], null, 2, 'error: parse 3\n', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Delete File: f.txt\n+oops\n*** End Patch\n' });
runCase(
  'V6 Update only Move to is pure move',
  { 'f.txt': 'hello\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** Move to: g.txt\n*** End Patch\n' },
  ['p.diff'], null, 0, 'R f.txt -> g.txt\nok: 1 file\n', { 'g.txt': 'hello\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** Move to: g.txt\n*** End Patch\n' },
);
runCase('V7 Update no chunk no move', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** End Patch\n' }, ['p.diff'], null, 2, 'error: parse 2\n', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** End Patch\n' });
runCase('V8 End of File with no chunk', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** End of File\n*** End Patch\n' }, ['p.diff'], null, 2, 'error: parse 3\n', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** End of File\n*** End Patch\n' });
runCase(
  'V9 anchor no-match',
  { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ missing anchor\n a\n-b\n+B\n*** End Patch\n' },
  ['p.diff'], null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ missing anchor\n a\n-b\n+B\n*** End Patch\n' },
);
runCase(
  'V10 anchor tier 1',
  { 'f.txt': 'def f(): \n    x = 1\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ def f():\n-    x = 1\n+    x = 2\n*** End Patch\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'def f(): \n    x = 2\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ def f():\n-    x = 1\n+    x = 2\n*** End Patch\n' },
);
runCase(
  'V11 empty-O EOF chunk inserts at end',
  { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ anchor-not-in-file\n*** End Patch\n' },
  ['p.diff'], null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n@@ anchor-not-in-file\n*** End Patch\n' },
);
runCase(
  'V11b empty-O EOF chunk inserts at end',
  { 'f.txt': 'a\nb', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n+c\n*** End of File\n*** End Patch\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\nb\nc', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n+c\n*** End of File\n*** End Patch\n' },
);
runCase(
  'V12 body line after EOF chunk',
  { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n*** End of File\n c\n*** End Patch\n' },
  ['p.diff'], null, 2, 'error: parse 7\n', { 'f.txt': 'a\nb\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n*** End of File\n c\n*** End Patch\n' },
);
runCase(
  'V13a Add exists',
  { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Add File: f.txt\n+y\n*** End Patch\n' },
  ['p.diff'], null, 1, 'error: exists f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'x\n', 'p.diff': '*** Begin Patch\n*** Add File: f.txt\n+y\n*** End Patch\n' },
);
runCase(
  'V13b Delete missing',
  { 'p.diff': '*** Begin Patch\n*** Delete File: no.txt\n*** End Patch\n' },
  ['p.diff'], null, 1, 'error: missing no.txt\nfailed: 1 of 1 edits\n', { 'p.diff': '*** Begin Patch\n*** Delete File: no.txt\n*** End Patch\n' },
);
runCase(
  'V13c Move to exists',
  { 'f.txt': 'x\n', 'g.txt': 'y\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** Move to: g.txt\n*** End Patch\n' },
  ['p.diff'], null, 1, 'error: exists g.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'x\n', 'g.txt': 'y\n', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n*** Move to: g.txt\n*** End Patch\n' },
);
runCase(
  'V14 CRLF preserved',
  { 'f.txt': 'a\r\nb', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' },
  ['p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'a\r\nB', 'p.diff': '*** Begin Patch\n*** Update File: f.txt\n a\n-b\n+B\n*** End Patch\n' },
);

// --- json ---
runCase('J1 array trailing garbage', { 'p.json': '[{"command":"create","path":"n.txt","file_text":"x"}] garbage\n' }, ['p.json'], null, 2, 'error: parse 1\n', { 'p.json': '[{"command":"create","path":"n.txt","file_text":"x"}] garbage\n' });
runCase(
  'J2 JSONL blank lines ignored',
  { 'p.json': '\n{"command":"create","path":"n.txt","file_text":"x"}\n\n' },
  ['p.json'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'x', 'p.json': '\n{"command":"create","path":"n.txt","file_text":"x"}\n\n' },
);
runCase(
  'J3 str_replace overlapping ambiguous',
  { 'f.txt': 'aaa\n', 'p.json': '{"command":"str_replace","path":"f.txt","old_str":"aa","new_str":"b"}\n' },
  ['p.json'], null, 1, 'error: ambiguous f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'aaa\n', 'p.json': '{"command":"str_replace","path":"f.txt","old_str":"aa","new_str":"b"}\n' },
);
runCase(
  'J4 insert out of range',
  { 'f.txt': 'a\nb\n', 'p.json': '{"command":"insert","path":"f.txt","insert_line":5,"new_str":"x"}\n' },
  ['p.json'], null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a\nb\n', 'p.json': '{"command":"insert","path":"f.txt","insert_line":5,"new_str":"x"}\n' },
);
runCase(
  'J5 create byte-for-byte CRLF',
  { 'p.json': '{"command":"create","path":"n.txt","file_text":"a\\r\\nb\\r\\n"}\n' },
  ['p.json'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'a\r\nb\r\n', 'p.json': '{"command":"create","path":"n.txt","file_text":"a\\r\\nb\\r\\n"}\n' },
);
runCase('J6 wrong command', { 'p.json': '{"command":"explode","path":"f.txt"}\n' }, ['p.json'], null, 2, 'error: parse 1\n', { 'p.json': '{"command":"explode","path":"f.txt"}\n' });
runCase(
  'J7 create then str_replace same file',
  { 'p.json': '[{"command":"create","path":"n.txt","file_text":"hello\\n"},{"command":"str_replace","path":"n.txt","old_str":"hello","new_str":"bye"}]\n' },
  ['p.json'], null, 0, 'A n.txt\nok: 1 file\n', { 'n.txt': 'bye\n', 'p.json': '[{"command":"create","path":"n.txt","file_text":"hello\\n"},{"command":"str_replace","path":"n.txt","old_str":"hello","new_str":"bye"}]\n' },
);

// --- misc ---
runCase('X1 -- after options', { 'f.txt': 'a\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' }, ['--', 'p.diff'], null, 0, 'M f.txt\nok: 1 file\n', { 'f.txt': 'A\n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' });
runCase('X2 options after positional', { 'f.txt': 'a \n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' }, ['p.diff', '--strict'], null, 1, 'error: no-match f.txt\nfailed: 1 of 1 edits\n', { 'f.txt': 'a \n', 'p.diff': '--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-a\n+A\n' });
runCase('X3 unsafe SR path', { 'p.diff': '../evil.txt\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE\n' }, ['p.diff'], null, 1, 'error: unsafe ../evil.txt\nfailed: 1 of 1 edits\n', { 'p.diff': '../evil.txt\n<<<<<<< SEARCH\n=======\nx\n>>>>>>> REPLACE\n' });
runCase('X4 unsafe V4A path', { 'p.diff': '*** Begin Patch\n*** Add File: /abs.txt\n+x\n*** End Patch\n' }, ['p.diff'], null, 1, 'error: unsafe /abs.txt\nfailed: 1 of 1 edits\n', { 'p.diff': '*** Begin Patch\n*** Add File: /abs.txt\n+x\n*** End Patch\n' });
runCase('X5 unsafe JSON path', { 'p.json': '{"command":"create","path":"a//b.txt","file_text":"x"}\n' }, ['p.json'], null, 1, 'error: unsafe a//b.txt\nfailed: 1 of 1 edits\n', { 'p.json': '{"command":"create","path":"a//b.txt","file_text":"x"}\n' });

console.log(`${pass} passed, ${fail} failed`);
if (failures.length > 0) console.log(failures.join('\n\n'));
process.exit(fail > 0 ? 1 : 0);
