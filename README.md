# makefun-mend-cli

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/mbahjito087-stack/makefun-mend-cli/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/mbahjito087-stack/makefun-mend-cli/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend is one patch tool for every AI edit format. It applies unified diffs (even with wrong
line numbers), SEARCH/REPLACE blocks, V4A patches and JSON text-editor tool calls to a tree
of text files — matching lines at three tiers of whitespace tolerance, re-indenting at the
deepest tier, and writing every change or none. Zero dependencies: Node 22 standard library
only.

On the make.fun dev set it scores 1000/1000: 100 of 100 practice checks pass (30 unified,
20 SEARCH/REPLACE, 20 V4A, 15 JSON, 15 CLI), confirmed with the kit's own runner, env server
and sealed scorer, plus 72 hand-written edge-case tests for the sentences the practice set
does not cover (`node edge-tests.mjs`).

## Run it

```sh
printf -- '--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-hello\n+hello, world\n' > hello.patch
printf 'hello\n' > hello.txt
node main.ts hello.patch
```

`node main.ts [options] [PATCH]` — PATCH is a patch file, or `-`/absent for standard input.
`--format=unified|search-replace|v4a|json|auto` (default `auto`) picks the format,
`--check` reports without writing, `--strict` matches lines exactly. See `SPEC.md` for the
full contract: exit codes, output lines, three-tier matching, and the all-or-nothing write.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2behakk4&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
