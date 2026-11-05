/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Loaded through Vite: this lab has no @types/node and `tsc --noEmit` gates
// its build.
const workflows = import.meta.glob('../.github/workflows/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const deploy = Object.entries(workflows).find(([path]) => path.endsWith('/deploy.yml'))?.[1];

/**
 * A merge made with `secrets.GITHUB_TOKEN` raises no push event, so the
 * `gh workflow run` in the auto-merge step is the only thing that ships a
 * self-merged Dependabot bump. The paragraph above it is the only place that
 * says so, and deleting the paragraph and deleting the line it defends are the
 * same edit six months apart.
 *
 * PR #23 rewrote that paragraph into a two-line paraphrase — "GITHUB_TOKEN
 * merges do not emit a push event" — which is true and which the fleet's
 * `dispatch-comment-sync` does not recognise, so the lab was reported as
 * carrying no rationale at all. The canonical five lines are back, verbatim
 * from the fleet's single definition.
 */
describe('the deploy dispatch keeps the paragraph that defends it', () => {
  it('has a deploy.yml to read', () => {
    expect(deploy).toBeDefined();
  });

  it('dispatches deploy.yml from the auto-merge step', () => {
    expect(deploy!).toMatch(/\n\s*gh workflow run deploy\.yml/);
  });

  it('carries the canonical rationale in the comment run directly above it', () => {
    const at = deploy!.indexOf('gh workflow run deploy.yml');
    const before = deploy!.slice(0, at).split('\n');
    before.pop();
    const block: string[] = [];
    while (before.length > 0 && /^\s*#/.test(before[before.length - 1]!)) block.unshift(before.pop()!);
    const text = block.join('\n');
    // The wording the fleet checker recognises, not a paraphrase of it.
    expect(text).toMatch(/raises no push event/);
    expect(text).toMatch(/is the same gate-then-deploy pipeline/);
  });

  it('keeps that closing claim true: the dispatched workflow gates before it publishes', () => {
    // "the same gate-then-deploy pipeline" only holds while deploy needs the gate.
    expect(deploy!).toMatch(/\n {2}deploy:\n(?:.*\n)*?\s+needs:\s*\[?[^\n]*build/);
  });

  it('lets a failed dispatch fail the step', () => {
    // `run:` uses `bash -e`, so a bare command suffices — but an
    // `|| echo "::warning::"` would swallow the failure, which is what this
    // lab's dispatch used to do.
    const at = deploy!.indexOf('gh workflow run deploy.yml');
    const statement = deploy!.slice(at, at + 200);
    expect(statement).not.toMatch(/\|\|\s*echo\s*"::warning::/);
  });
});
