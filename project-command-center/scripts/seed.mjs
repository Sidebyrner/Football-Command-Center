#!/usr/bin/env node
/**
 * seed.mjs — one-time bootstrap of the ledger from a GitHub repo listing.
 *
 * Status here is a *guess* from push recency, which is why every seeded
 * project carries needs_triage: true. Nothing is claimed as known until a
 * human confirms it. Safe to re-run: existing files are left alone.
 */
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankProject, saveProject, today } from './portfolio.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Snapshot taken 2026-09-17.
const REPOS = [
  ['Sidebyrner/bartender-101', '2026-09-16', 'public'],
  ['Sidebyrner/Nocturne', '2026-09-16', 'private'],
  ['Sidebyrner/Football-Command-Center', '2026-09-14', 'public'],
  ['Sidebyrner/mrjs-sports-bar', '2026-09-09', 'private'],
  ['Sidebyrner/bartender-memory-trainer', '2026-08-29', 'public'],
  ['Sidebyrner/Catch', '2026-08-27', 'public'],
  ['Sidebyrner/New-Desktop-Lawn-Pro', '2026-06-12', 'private'],
  ['Sidebyrner/Job-Tracker', '2026-06-03', 'private'],
  ['Sidebyrner/AR-Collections-Dashboard', '2026-05-20', 'private'],
  ['Sidebyrner/Lawn-Pro', '2026-05-19', 'public'],
  ['Sidebyrner/diet_tracker', '2026-04-30', 'public'],
  ['Sidebyrner/item_budgetizer', '2026-03-16', 'public'],
  ['Sidebyrner/2026-march-madness', '2026-03-16', 'public'],
  ['Sidebyrner/qwen_protocol_producer', '2026-03-13', 'public'],
  ['Sidebyrner/protocol_producer', '2026-03-13', 'public'],
  ['Sidebyrner/questForge_toDo', '2026-03-12', 'public'],
  ['Sidebyrner/finance_dashboard', '2026-02-26', 'private'],
  ['Sidebyrner/skills-github-pages', '2025-12-01', 'public'],
  ['Sidebyrner/skills-connect-the-dots', '2025-12-01', 'public'],
  ['Sidebyrner/enhanced-poker-solver', '2025-08-05', 'private'],
  ['Sidebyrner/enhanced-finance-dashboard', '2025-07-31', 'public'],
  ['Sidebyrner/connorsdigitalgarden', '2025-04-09', 'public'],
  ['Sidebyrner/mydigitalgarden', '2025-03-08', 'public'],
  ['Sidebyrner/gambling_game', '2025-02-27', 'public'],
  ['Sidebyrner/movie_ims', '2024-11-23', 'public'],
  ['Sidebyrner/sidebyrner', '2024-11-19', 'public'],
  ['Sidebyrner/hello-world', '2024-11-19', 'private'],
];

const days = (d) => Math.floor((Date.parse(today()) - Date.parse(d)) / 86400000);

/** Push recency is the only signal available before triage. */
const guessStatus = (pushed) => {
  const d = days(pushed);
  if (d <= 30) return 'active';
  if (d <= 365) return 'paused';
  return 'archived';
};

const slugFor = (repo) =>
  repo.split('/')[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The only project triaged at seed time — its repo was read directly, so its
// next action and backlog are real rather than guessed.
const FCC = {
  name: 'Football Command Center',
  why: 'Personal fantasy football research hub for Sleeper leagues — browser-only, no backend.',
  status: 'active',
  health: 'on-track',
  needs_triage: false,
  stack: ['react', 'vite', 'tailwind', 'zustand', 'recharts'],
  tags: ['fantasy-football', 'personal', 'web'],
  next_action: {
    what: 'Build src/components/research/MoneybballWidget.jsx and render it from src/pages/Research.jsx',
    energy: 'deep',
    minutes: 120,
    why: 'Full spec already written in To-Dos/moneyball-widget-claude-code.md; no component exists yet.',
  },
  backlog: [
    { what: 'Move the league scoring upload from its current page into Settings', energy: 'medium', minutes: 45 },
    { what: 'Auto-detect league PPR setting (0 / 0.5 / full) from Sleeper league data', energy: 'medium', minutes: 45 },
    { what: 'Add a light mode color scheme alongside the dark-first tokens', energy: 'medium', minutes: 60 },
    { what: 'Keep the player card open while scrolling the chart; click swaps the player in place', energy: 'deep', minutes: 90 },
    { what: 'Make nflverse data autoload instead of requiring the preprocess script', energy: 'deep', minutes: 90 },
    { what: 'Split the eval formula per position so each has its own strength/weakness weighting', energy: 'deep', minutes: 150 },
  ],
  log: [
    {
      date: today(),
      kind: 'note',
      summary: 'Seeded into the portfolio ledger. Backlog lifted from To-Dos/ — the Mock Draft and Odds to-dos were dropped because those pages already exist.',
    },
  ],
};

let created = 0, skipped = 0;
for (const [repo, pushed, visibility] of REPOS) {
  const slug = slugFor(repo);
  if (existsSync(join(ROOT, 'projects', `${slug}.json`))) { skipped++; continue; }

  const isFCC = repo === 'Sidebyrner/Football-Command-Center';
  saveProject(blankProject(slug, {
    repo,
    visibility,
    name: isFCC ? FCC.name : repo.split('/')[1].replace(/[-_]/g, ' '),
    status: isFCC ? FCC.status : guessStatus(pushed),
    last_touched: pushed,
    created: today(),
    ...(isFCC ? FCC : { needs_triage: true }),
  }));
  created++;
}

console.log(`seeded ${created} project(s), skipped ${skipped} existing`);
