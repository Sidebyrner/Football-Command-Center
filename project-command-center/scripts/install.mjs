#!/usr/bin/env node
/**
 * install.mjs — wire the portfolio into Claude Code.
 *
 *   node scripts/install.mjs                     symlink the skill into ~/.claude/skills
 *   node scripts/install.mjs --copy              copy the skill instead of linking
 *   node scripts/install.mjs --hook <repo-dir>   install the Stop hook into one repo
 *   node scripts/install.mjs --hook-global       install the Stop hook for every local repo
 *
 * Settings files are merged, never overwritten, and installing twice is a no-op.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, cpSync, lstatSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME_CLAUDE = join(homedir(), '.claude');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : undefined;
};

const ok = (m) => console.log(`[32m✓[0m ${m}`);
const warn = (m) => console.log(`[33m![0m ${m}`);
const die = (m) => { console.error(`[31merror:[0m ${m}`); process.exit(1); };

const HOOK_COMMAND_LOCAL = 'node .claude/hooks/portfolio-log.mjs';
const HOOK_COMMAND_GLOBAL = `node ${join(ROOT, 'hooks', 'portfolio-log.mjs')}`;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    die(`${path} is not valid JSON (${e.message}) — fix or move it, then re-run.`);
  }
}

/** Add our Stop hook to a settings object without disturbing anything already there. */
function mergeStopHook(settings, command) {
  settings.hooks ||= {};
  settings.hooks.Stop ||= [];

  const already = settings.hooks.Stop.some((m) =>
    (m?.hooks || []).some((h) => typeof h?.command === 'string' && h.command.includes('portfolio-log.mjs'))
  );
  if (already) return false;

  settings.hooks.Stop.push({ hooks: [{ type: 'command', command }] });
  return true;
}

function installSkill() {
  const src = join(ROOT, '.claude', 'skills', 'project-portfolio');
  const dest = join(HOME_CLAUDE, 'skills', 'project-portfolio');
  if (!existsSync(src)) die(`skill source missing at ${src}`);

  mkdirSync(dirname(dest), { recursive: true });

  if (existsSync(dest) || lstatSync(dest, { throwIfNoEntry: false })) {
    const isOurLink = lstatSync(dest).isSymbolicLink();
    if (!isOurLink && !has('--force')) {
      warn(`${dest} already exists and is not a symlink — leaving it alone (pass --force to replace)`);
      return;
    }
    rmSync(dest, { recursive: true, force: true });
  }

  if (has('--copy')) {
    cpSync(src, dest, { recursive: true });
    ok(`copied skill to ${dest}`);
    warn('a copy will not track edits made here — re-run install.mjs after changing SKILL.md');
  } else {
    symlinkSync(src, dest, 'dir');
    ok(`linked skill: ${dest} -> ${src}`);
  }
}

function installHookLocal(repoDir) {
  const dir = resolve(repoDir);
  if (!existsSync(dir)) die(`no such directory: ${dir}`);
  if (!existsSync(join(dir, '.git'))) warn(`${dir} does not look like a git repo — the hook records nothing outside one`);

  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true });
  cpSync(join(ROOT, 'hooks', 'portfolio-log.mjs'), join(dir, '.claude', 'hooks', 'portfolio-log.mjs'));
  ok(`copied hook to ${join(dir, '.claude', 'hooks', 'portfolio-log.mjs')}`);

  const settingsPath = join(dir, '.claude', 'settings.json');
  const settings = readJson(settingsPath, {});
  if (mergeStopHook(settings, HOOK_COMMAND_LOCAL)) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    ok(`registered Stop hook in ${settingsPath}`);
    console.log('  commit .claude/hooks/portfolio-log.mjs and .claude/settings.json so it works in web sessions too');
  } else {
    ok('Stop hook already registered — nothing to do');
  }
}

function installHookGlobal() {
  mkdirSync(HOME_CLAUDE, { recursive: true });
  const settingsPath = join(HOME_CLAUDE, 'settings.json');
  const settings = readJson(settingsPath, {});
  if (mergeStopHook(settings, HOOK_COMMAND_GLOBAL)) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    ok(`registered global Stop hook in ${settingsPath}`);
    console.log('  every local repo now reports into the portfolio inbox');
    console.log('  note: this does not apply to Claude Code on the web — use --hook <repo> there');
  } else {
    ok('global Stop hook already registered — nothing to do');
  }
}

function main() {
  if (has('--hook-global')) return installHookGlobal();

  if (has('--hook')) {
    const dir = valueOf('--hook');
    if (!dir || dir.startsWith('--')) die('--hook needs a repo directory, e.g. --hook ~/code/my-project');
    return installHookLocal(dir);
  }

  installSkill();
  console.log('');
  console.log('Next:');
  console.log('  node scripts/install.mjs --hook <repo>   capture sessions from a project repo');
  console.log('  node scripts/portfolio.mjs board         see where everything stands');
}

main();
