#!/usr/bin/env node
/**
 * portfolio-log.mjs — Claude Code `Stop` hook.
 *
 * Fires when a session finishes and drops one record into the portfolio
 * inbox (~/.claude/portfolio-inbox by default). It records only hard git
 * facts — a hook is a shell command, not a model, so it cannot summarize
 * what the session was *about*. `portfolio inbox --drain` folds these into
 * the ledger, and the `project-portfolio` skill writes the narrative.
 *
 * Install per-repo in .claude/settings.json:
 *   { "hooks": { "Stop": [ { "hooks": [
 *       { "type": "command", "command": "node .claude/hooks/portfolio-log.mjs" } ] } ] } }
 *
 * This hook never blocks a session: every failure path exits 0 in silence.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const INBOX = process.env.PORTFOLIO_INBOX || join(homedir(), '.claude', 'portfolio-inbox');

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

/** When did this session begin? First transcript timestamp, else the file's birth time. */
function sessionStart(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  try {
    const head = readFileSync(transcriptPath, 'utf8').slice(0, 64 * 1024).split('\n');
    for (const line of head) {
      if (!line.trim()) continue;
      const ts = JSON.parse(line)?.timestamp;
      if (ts && !Number.isNaN(Date.parse(ts))) return new Date(ts).toISOString();
    }
  } catch { /* fall through */ }
  try {
    const { birthtime, mtime } = statSync(transcriptPath);
    const t = birthtime?.getTime() ? birthtime : mtime;
    return t.toISOString();
  } catch {
    return null;
  }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd || process.cwd();

  const root = git(['rev-parse', '--show-toplevel'], cwd);
  if (!root) return; // not a git repo — nothing worth recording

  const remote = git(['remote', 'get-url', 'origin'], root);
  const repo = remote
    ? (remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)?.[1] || null)
    : null;
  const slug = slugify(repo ? repo.split('/').pop() : basename(root));
  if (!slug) return;

  const since = sessionStart(input.transcript_path);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);

  // Commits can only be attributed to this session if we know when it began.
  // Without that, report nothing rather than passing off pre-existing history
  // as this session's work.
  const commitLines = since
    ? git(['log', '--pretty=%h %s', `--since=${since}`], root).split('\n').filter(Boolean)
    : null;

  // Uncommitted work still counts as work — record it so nothing looks idle.
  const dirty = git(['status', '--porcelain'], root).split('\n').filter(Boolean).length;
  const changed = new Set(
    git(['diff', '--name-only', 'HEAD'], root).split('\n').filter(Boolean)
  );
  if (since) {
    for (const f of git(['log', `--since=${since}`, '--name-only', '--pretty=format:'], root).split('\n')) {
      if (f.trim()) changed.add(f.trim());
    }
  }

  // A session that touched nothing is noise in the ledger.
  if (!commitLines?.length && !dirty) return;

  const record = {
    slug,
    repo,
    dir: root,
    date: new Date().toISOString().slice(0, 10),
    at: new Date().toISOString(),
    branch: branch && branch !== 'HEAD' ? branch : null,
    since,
    commits: commitLines ? commitLines.length : null,
    commit_subjects: commitLines ? commitLines.slice(0, 10) : [],
    files_changed: changed.size,
    uncommitted: dirty,
    session: input.session_id ? `https://claude.ai/code/${input.session_id}` : null,
    summary: [
      commitLines?.length ? `${commitLines.length} commit(s)` : null,
      changed.size ? `${changed.size} file(s) touched` : null,
      dirty ? `${dirty} uncommitted change(s)` : null,
      branch && branch !== 'HEAD' ? `on ${branch}` : null,
      commitLines ? null : '(session start unknown — commit count not recorded)',
    ].filter(Boolean).join(', '),
  };

  mkdirSync(INBOX, { recursive: true });
  const name = `${record.at.replace(/[:.]/g, '-')}-${slug}.json`;
  writeFileSync(join(INBOX, name), JSON.stringify(record, null, 2) + '\n');
}

try { main(); } catch { /* a bookkeeping hook must never break a session */ }
process.exit(0);
