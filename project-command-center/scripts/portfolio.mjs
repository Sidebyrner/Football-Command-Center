#!/usr/bin/env node
/**
 * portfolio.mjs — the project ledger CLI.
 *
 * Zero dependencies. Every project is one JSON file in projects/.
 * The ledger is the source of truth; PORTFOLIO.md is a generated view.
 *
 *   node scripts/portfolio.mjs board
 *   node scripts/portfolio.mjs pick --energy quick --minutes 30
 *   node scripts/portfolio.mjs log <slug> --summary "..." [--next "..."] [--energy deep]
 *   node scripts/portfolio.mjs set <slug> --status paused --blocked "waiting on API key"
 *   node scripts/portfolio.mjs new <slug> --name "..." --repo owner/name
 *   node scripts/portfolio.mjs inbox [--drain]
 *   node scripts/portfolio.mjs validate
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_DIR = join(ROOT, 'projects');
const INBOX_DIR = process.env.PORTFOLIO_INBOX || join(homedir(), '.claude', 'portfolio-inbox');

export const ENERGY = ['quick', 'medium', 'deep'];
export const STATUS = ['active', 'paused', 'idea', 'shipped', 'archived'];
export const HEALTH = ['on-track', 'at-risk', 'stalled', 'unknown'];

// ---------------------------------------------------------------- utilities

const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (isTTY ? `[${code}m${s}[0m` : String(s));
const bold = c(1), dim = c(2), red = c(31), green = c(32), yellow = c(33), blue = c(34), magenta = c(35), cyan = c(36);

const STATUS_COLOR = { active: green, paused: yellow, idea: blue, shipped: cyan, archived: dim };
const ENERGY_COLOR = { quick: green, medium: yellow, deep: magenta };
const ENERGY_LABEL = { quick: 'quick', medium: 'medium', deep: 'deep  ' };

export const today = () => new Date().toISOString().slice(0, 10);

export function daysSince(dateStr) {
  if (!dateStr) return 9999;
  const then = Date.parse(dateStr + (dateStr.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(then)) return 9999;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

export const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function fail(msg) {
  console.error(red('error: ') + msg);
  process.exit(1);
}

/** Minimal flag parser: --key value, --key=value, and bare --flag booleans. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

// ------------------------------------------------------------------ ledger

export function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const path = join(PROJECTS_DIR, f);
      try {
        return { ...JSON.parse(readFileSync(path, 'utf8')), _path: path };
      } catch (e) {
        fail(`${f} is not valid JSON: ${e.message}`);
      }
    });
}

export function loadProject(slug) {
  const path = join(PROJECTS_DIR, `${slug}.json`);
  if (!existsSync(path)) {
    const known = listProjects().map((p) => p.slug);
    const near = known.filter((k) => k.includes(slug) || slug.includes(k));
    fail(`no project "${slug}".` + (near.length ? ` Did you mean: ${near.join(', ')}?` : ` Known: ${known.join(', ')}`));
  }
  return { ...JSON.parse(readFileSync(path, 'utf8')), _path: path };
}

/** Write atomically so a crash mid-write can never truncate the ledger. */
export function saveProject(p) {
  const { _path, ...data } = p;
  const path = _path || join(PROJECTS_DIR, `${data.slug}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, path);
  return path;
}

export function blankProject(slug, extra = {}) {
  return {
    slug,
    name: extra.name || slug,
    repo: extra.repo || null,
    url: extra.url || (extra.repo ? `https://github.com/${extra.repo}` : null),
    visibility: extra.visibility || 'unknown',
    status: extra.status || 'idea',
    health: extra.health || 'unknown',
    why: extra.why || null,
    stack: extra.stack || [],
    tags: extra.tags || [],
    needs_triage: extra.needs_triage ?? true,
    next_action: extra.next_action || null,
    backlog: extra.backlog || [],
    blocked_by: extra.blocked_by || null,
    created: extra.created || today(),
    last_touched: extra.last_touched || null,
    log: extra.log || [],
  };
}

// ------------------------------------------------------------------ scoring

/**
 * Every candidate action a project can offer, cheapest first.
 * next_action is preferred, but a backlog item that fits a smaller
 * window is better than nothing — that is the whole point of the tool.
 */
export function candidateActions(p) {
  const acts = [];
  if (p.next_action?.what) acts.push({ ...p.next_action, source: 'next_action' });
  for (const b of p.backlog || []) if (b?.what) acts.push({ ...b, source: 'backlog' });
  return acts.map((a) => ({
    ...a,
    energy: ENERGY.includes(a.energy) ? a.energy : 'medium',
    minutes: Number.isFinite(a.minutes) ? a.minutes : 60,
  }));
}

export function fits(action, haveEnergy, haveMinutes) {
  const energyOk = ENERGY.indexOf(action.energy) <= ENERGY.indexOf(haveEnergy);
  const timeOk = haveMinutes == null || action.minutes <= haveMinutes;
  return energyOk && timeOk;
}

const STATUS_WEIGHT = { active: 30, paused: 14, idea: 6, shipped: 0, archived: 0 };
const HEALTH_WEIGHT = { stalled: 12, 'at-risk': 18, 'on-track': 0, unknown: 4 };

/**
 * Rank a fitting action. Four pulls, deliberately balanced:
 *   staleness  — a project untouched for 60 days should surface over one touched yesterday
 *   commitment — what you called active outranks what you called an idea
 *   designated — next_action is the move you already decided on; a backlog item
 *                has to be a clearly better fit to displace it
 *   fill       — with 90 minutes free, an 80-minute task beats a 10-minute one
 */
export function scoreAction(p, action, haveMinutes) {
  const stale = Math.min(daysSince(p.last_touched), 90) / 90 * 40;
  const commitment = STATUS_WEIGHT[p.status] ?? 0;
  const health = HEALTH_WEIGHT[p.health] ?? 0;
  const designated = action.source === 'next_action' ? 12 : 0;
  const fill = haveMinutes ? Math.min(action.minutes / haveMinutes, 1) * 20 : 10;
  const triage = p.needs_triage ? -6 : 0; // untriaged projects are guesses; prefer known work
  return Math.round((stale + commitment + health + designated + fill + triage) * 10) / 10;
}

export function explain(p, action, haveMinutes) {
  const bits = [];
  const d = daysSince(p.last_touched);
  if (d >= 9999) bits.push('never logged');
  else if (d > 30) bits.push(`untouched ${d}d`);
  else if (d > 7) bits.push(`${d}d since last touch`);
  else bits.push(`touched ${d}d ago`);
  if (p.health === 'at-risk' || p.health === 'stalled') bits.push(p.health);
  if (action.source === 'backlog') bits.push('from backlog');
  if (haveMinutes && action.minutes <= haveMinutes * 0.4) bits.push('leaves time to spare');
  return bits.join(' · ');
}

// ----------------------------------------------------------------- commands

function cmdBoard(args) {
  const all = listProjects();
  if (!all.length) fail('no projects in the ledger yet. Try: portfolio new <slug>');

  const showAll = !!args.all;
  const order = showAll ? STATUS : ['active', 'paused', 'idea'];
  const lines = [];

  for (const status of order) {
    const group = all.filter((p) => p.status === status)
      .sort((a, b) => daysSince(b.last_touched) - daysSince(a.last_touched));
    if (!group.length) continue;

    lines.push('');
    lines.push(bold((STATUS_COLOR[status] || ((s) => s))(status.toUpperCase())) + dim(`  (${group.length})`));

    for (const p of group) {
      const d = daysSince(p.last_touched);
      const age = d >= 9999 ? dim('  never') : (d > 30 ? red : d > 7 ? yellow : dim)(String(d + 'd').padStart(6));
      lines.push(`  ${age}  ${bold(p.name)}${p.needs_triage ? dim(' [triage]') : ''}`);

      if (p.blocked_by) {
        lines.push(`          ${red('blocked')} ${p.blocked_by}`);
      } else if (p.next_action?.what) {
        const a = p.next_action;
        const en = (ENERGY_COLOR[a.energy] || dim)(ENERGY_LABEL[a.energy] || a.energy);
        lines.push(`          ${en} ${dim(String(a.minutes || '?') + 'm')}  ${a.what}`);
      } else {
        lines.push(`          ${dim('no next action set')}`);
      }
    }
  }

  const triage = all.filter((p) => p.needs_triage && p.status !== 'archived').length;
  const active = all.filter((p) => p.status === 'active').length;
  const blocked = all.filter((p) => p.blocked_by).length;

  lines.push('');
  lines.push(dim('─'.repeat(64)));
  lines.push(
    `${all.length} projects · ${green(active + ' active')} · ${blocked ? red(blocked + ' blocked') : '0 blocked'}` +
    (triage ? ` · ${yellow(triage + ' need triage')}` : '')
  );
  if (!showAll) lines.push(dim('(shipped and archived hidden — pass --all to see them)'));

  console.log(lines.join('\n'));
  if (args.write !== false) writeMarkdown(all);
}

function cmdPick(args) {
  const haveEnergy = String(args.energy || 'deep').toLowerCase();
  if (!ENERGY.includes(haveEnergy)) fail(`--energy must be one of: ${ENERGY.join(', ')}`);
  const haveMinutes = args.minutes ? Number(args.minutes) : null;
  if (args.minutes && !Number.isFinite(haveMinutes)) fail('--minutes must be a number');
  const limit = Number(args.limit || 3);

  const pool = listProjects().filter((p) => {
    if (p.blocked_by) return false;
    if (!['active', 'paused', 'idea'].includes(p.status)) return false;
    if (args.tag && !(p.tags || []).includes(args.tag)) return false;
    return true;
  });

  const ranked = [];
  for (const p of pool) {
    const fitting = candidateActions(p).filter((a) => fits(a, haveEnergy, haveMinutes));
    if (!fitting.length) continue;
    // Best single offer per project — don't let one busy project flood the list.
    const best = fitting
      .map((a) => ({ p, action: a, score: scoreAction(p, a, haveMinutes) }))
      .sort((x, y) => y.score - x.score)[0];
    ranked.push(best);
  }
  ranked.sort((a, b) => b.score - a.score);

  const window = haveMinutes ? `${haveMinutes} min` : 'open-ended';
  console.log('');
  console.log(bold(`Energy: ${(ENERGY_COLOR[haveEnergy] || dim)(haveEnergy)}   Window: ${window}`));

  if (!ranked.length) {
    console.log('');
    console.log(yellow('Nothing in the ledger fits that.'));
    const blocked = pool.length === 0 ? listProjects().filter((p) => p.blocked_by) : [];
    if (blocked.length) console.log(dim(`${blocked.length} project(s) are blocked — see: portfolio board`));
    console.log(dim('Try a longer window, higher energy, or add quick wins to a backlog.'));
    return;
  }

  console.log('');
  ranked.slice(0, limit).forEach((r, i) => {
    const head = i === 0 ? green('▸ ') : dim('  ');
    console.log(`${head}${bold(r.p.name)} ${dim('· ' + r.p.slug)}`);
    console.log(`    ${r.action.what}`);
    const meta = [
      (ENERGY_COLOR[r.action.energy] || dim)(r.action.energy),
      `${r.action.minutes}m`,
      explain(r.p, r.action, haveMinutes),
    ].filter(Boolean).join(dim(' · '));
    console.log(`    ${dim(meta)}`);
    if (r.action.why) console.log(`    ${dim('why: ' + r.action.why)}`);
    if (i === 0 && r.p.url) console.log(`    ${dim(r.p.url)}`);
    console.log('');
  });
}

function cmdLog(args) {
  const slug = args._[0];
  if (!slug) fail('usage: portfolio log <slug> --summary "what happened"');
  const summary = args.summary;
  if (!summary || summary === true) fail('--summary is required');

  const p = loadProject(slug);
  const entry = {
    date: args.date || today(),
    kind: args.kind || 'session',
    summary: String(summary),
  };
  if (args.session) entry.session = String(args.session);
  if (args.commits) entry.commits = String(args.commits);
  if (args.files) entry.files = Number(args.files);

  p.log = p.log || [];
  p.log.unshift(entry);
  if (p.log.length > 100) p.log.length = 100; // keep files readable; git holds the rest
  p.last_touched = entry.date;
  if (p.needs_triage && (args.next || args.status)) p.needs_triage = false;

  applyMutations(p, args);
  saveProject(p);

  console.log(`${green('logged')} ${bold(p.name)} — ${entry.summary}`);
  if (p.next_action?.what) console.log(dim(`  next: ${p.next_action.what} (${p.next_action.energy}, ${p.next_action.minutes}m)`));
}

function cmdSet(args) {
  const slug = args._[0];
  if (!slug) fail('usage: portfolio set <slug> --status active --next "..." --energy deep --minutes 90');
  const p = loadProject(slug);
  applyMutations(p, args);
  if (args.triaged) p.needs_triage = false;
  saveProject(p);
  console.log(`${green('updated')} ${bold(p.name)} ${dim(`[${p.status}${p.blocked_by ? ', blocked' : ''}]`)}`);
  if (p.next_action?.what) console.log(dim(`  next: ${p.next_action.what} (${p.next_action.energy}, ${p.next_action.minutes}m)`));
}

/** Shared field updates for `log` and `set`. */
function applyMutations(p, args) {
  if (args.status) {
    if (!STATUS.includes(args.status)) fail(`--status must be one of: ${STATUS.join(', ')}`);
    p.status = args.status;
  }
  if (args.health) {
    if (!HEALTH.includes(args.health)) fail(`--health must be one of: ${HEALTH.join(', ')}`);
    p.health = args.health;
  }
  if (args.why && args.why !== true) p.why = String(args.why);
  if (args.tags && args.tags !== true) p.tags = String(args.tags).split(',').map((s) => s.trim()).filter(Boolean);
  if (args.stack && args.stack !== true) p.stack = String(args.stack).split(',').map((s) => s.trim()).filter(Boolean);

  // --blocked "reason" sets a block; --unblock clears it.
  if (args.unblock) p.blocked_by = null;
  if (args.blocked && args.blocked !== true) p.blocked_by = String(args.blocked);

  if (args.next !== undefined) {
    if (args.next === true || args.next === '' || args.next === 'none') {
      p.next_action = null;
    } else {
      const energy = args.energy && args.energy !== true ? String(args.energy) : 'medium';
      if (!ENERGY.includes(energy)) fail(`--energy must be one of: ${ENERGY.join(', ')}`);
      p.next_action = {
        what: String(args.next),
        energy,
        minutes: args.minutes ? Number(args.minutes) : 60,
        ...(args['next-why'] && args['next-why'] !== true ? { why: String(args['next-why']) } : {}),
      };
      p.needs_triage = false;
    }
  } else if (p.next_action && (args.energy || args.minutes)) {
    // Re-estimating an existing action without rewording it.
    if (args.energy && args.energy !== true) {
      if (!ENERGY.includes(String(args.energy))) fail(`--energy must be one of: ${ENERGY.join(', ')}`);
      p.next_action.energy = String(args.energy);
    }
    if (args.minutes) p.next_action.minutes = Number(args.minutes);
  }

  if (args.backlog && args.backlog !== true) {
    p.backlog = p.backlog || [];
    p.backlog.push({
      what: String(args.backlog),
      energy: args['backlog-energy'] && args['backlog-energy'] !== true ? String(args['backlog-energy']) : 'medium',
      minutes: args['backlog-minutes'] ? Number(args['backlog-minutes']) : 30,
    });
  }
}

function cmdNew(args) {
  const slug = slugify(args._[0] || args.name || '');
  if (!slug) fail('usage: portfolio new <slug> --name "Display Name" --repo owner/name');
  const path = join(PROJECTS_DIR, `${slug}.json`);
  if (existsSync(path)) fail(`${slug} already exists`);
  const p = blankProject(slug, {
    name: args.name && args.name !== true ? String(args.name) : slug,
    repo: args.repo && args.repo !== true ? String(args.repo) : null,
    status: args.status && args.status !== true ? String(args.status) : 'idea',
  });
  applyMutations(p, args);
  saveProject(p);
  console.log(`${green('created')} ${path.replace(ROOT + '/', '')}`);
}

/**
 * Drain session records dropped by the Stop hook.
 * The hook cannot summarize a session, so it records hard git facts and
 * leaves the narrative to whoever runs `log` next.
 */
function cmdInbox(args) {
  if (!existsSync(INBOX_DIR)) {
    console.log(dim(`inbox empty (${INBOX_DIR})`));
    return;
  }
  const files = readdirSync(INBOX_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) { console.log(dim('inbox empty')); return; }

  const bySlug = new Map();
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(readFileSync(join(INBOX_DIR, f), 'utf8')); }
    catch { console.error(yellow(`skipping unreadable inbox file ${f}`)); continue; }
    const slug = rec.slug || slugify(rec.repo?.split('/').pop() || rec.dir || '');
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push({ ...rec, _file: f });
  }

  console.log(bold(`${files.length} session record(s) across ${bySlug.size} project(s)`));
  for (const [slug, recs] of bySlug) {
    const known = existsSync(join(PROJECTS_DIR, `${slug}.json`));
    console.log(`  ${known ? green('✓') : yellow('?')} ${slug} ${dim(`(${recs.length})`)}${known ? '' : yellow('  not in ledger')}`);
    for (const r of recs.slice(0, 3)) {
      console.log(dim(`      ${r.date} ${r.branch || ''} ${r.commits ?? 0} commit(s), ${r.files_changed ?? 0} file(s)`));
    }
  }

  if (!args.drain) {
    console.log('');
    console.log(dim('pass --drain to append these to the ledger and clear the inbox'));
    return;
  }

  let applied = 0;
  for (const [slug, recs] of bySlug) {
    if (!existsSync(join(PROJECTS_DIR, `${slug}.json`))) continue;
    const p = loadProject(slug);
    p.log = p.log || [];
    for (const r of recs) {
      p.log.unshift({
        date: r.date,
        kind: 'session',
        summary: r.summary || `${r.commits ?? 0} commit(s), ${r.files_changed ?? 0} file(s) changed on ${r.branch || 'unknown branch'}`,
        ...(r.session ? { session: r.session } : {}),
      });
      applied++;
    }
    p.log.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (p.log.length > 100) p.log.length = 100;
    p.last_touched = p.log[0]?.date || p.last_touched;
    saveProject(p);
    for (const r of recs) { try { unlinkSync(join(INBOX_DIR, r._file)); } catch {} }
  }
  console.log(`${green('drained')} ${applied} entr${applied === 1 ? 'y' : 'ies'}`);
}

function cmdValidate() {
  const all = listProjects();
  const problems = [];
  const seen = new Set();

  for (const p of all) {
    const where = p._path.replace(ROOT + '/', '');
    if (!p.slug) problems.push(`${where}: missing slug`);
    if (p.slug && seen.has(p.slug)) problems.push(`${where}: duplicate slug "${p.slug}"`);
    seen.add(p.slug);
    if (p.slug && !p._path.endsWith(`${p.slug}.json`)) problems.push(`${where}: filename does not match slug "${p.slug}"`);
    if (!STATUS.includes(p.status)) problems.push(`${where}: bad status "${p.status}"`);
    if (p.health && !HEALTH.includes(p.health)) problems.push(`${where}: bad health "${p.health}"`);
    for (const a of candidateActions(p)) {
      if (!ENERGY.includes(a.energy)) problems.push(`${where}: bad energy "${a.energy}" on "${a.what}"`);
      if (!Number.isFinite(a.minutes) || a.minutes <= 0) problems.push(`${where}: bad minutes on "${a.what}"`);
    }
    // An untriaged project has not been reviewed yet, so a missing next
    // action is expected. Once triaged, "active" must mean actionable.
    if (p.status === 'active' && !p.needs_triage && !p.next_action?.what && !p.blocked_by) {
      problems.push(`${where}: active but has no next_action and is not blocked`);
    }
  }

  if (!problems.length) {
    console.log(`${green('✓')} ${all.length} project(s) valid`);
    return;
  }
  problems.forEach((p) => console.error(`${red('✗')} ${p}`));
  process.exit(1);
}

// ------------------------------------------------------------- markdown view

function writeMarkdown(all) {
  const out = ['# Portfolio', '', `_Generated by \`scripts/portfolio.mjs board\` on ${today()}. Edit the JSON in \`projects/\`, not this file._`, ''];

  const active = all.filter((p) => p.status === 'active').length;
  const blocked = all.filter((p) => p.blocked_by);
  const triage = all.filter((p) => p.needs_triage && p.status !== 'archived');
  out.push(`**${all.length}** projects · **${active}** active · **${blocked.length}** blocked · **${triage.length}** awaiting triage`, '');

  if (blocked.length) {
    out.push('## Blocked', '');
    for (const p of blocked) out.push(`- **${p.name}** — ${p.blocked_by}`);
    out.push('');
  }

  for (const status of STATUS) {
    const group = all.filter((p) => p.status === status)
      .sort((a, b) => daysSince(b.last_touched) - daysSince(a.last_touched));
    if (!group.length) continue;
    out.push(`## ${status[0].toUpperCase() + status.slice(1)}`, '');
    out.push('| Project | Next action | Energy | Est. | Last touched |');
    out.push('|---|---|---|---|---|');
    for (const p of group) {
      const link = p.url ? `[${p.name}](${p.url})` : p.name;
      const a = p.next_action;
      const next = p.blocked_by ? `⛔ ${p.blocked_by}` : (a?.what || '_none set_');
      const d = daysSince(p.last_touched);
      out.push(`| ${link} | ${next} | ${a && !p.blocked_by ? a.energy : '—'} | ${a && !p.blocked_by ? a.minutes + 'm' : '—'} | ${d >= 9999 ? 'never' : d + 'd ago'} |`);
    }
    out.push('');
  }

  writeFileSync(join(ROOT, 'PORTFOLIO.md'), out.join('\n'));
}

// -------------------------------------------------------------------- entry

const COMMANDS = { board: cmdBoard, pick: cmdPick, log: cmdLog, set: cmdSet, new: cmdNew, inbox: cmdInbox, validate: cmdValidate };

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(2, 18).join('\n').replace(/^ \* ?/gm, ''));
    return;
  }
  const fn = COMMANDS[cmd];
  if (!fn) fail(`unknown command "${cmd}". Try one of: ${Object.keys(COMMANDS).join(', ')}`);
  fn(parseArgs(rest));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
