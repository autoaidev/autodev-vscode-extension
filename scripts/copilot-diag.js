#!/usr/bin/env node
// ---------------------------------------------------------------------------
// copilot-diag.js  — Copilot TUI / SDK diagnostic for headless Linux
//
// Usage (on the Linux machine):
//   node copilot-diag.js
//   GITHUB_TOKEN=ghp_xxx node copilot-diag.js
//
// What it checks:
//   1. Node.js version + platform
//   2. @github/copilot npm location
//   3. sdk/index.js existence
//   4. pty.node native binary (required by SDK)
//   5. Dynamic import of the SDK
//   6. Auth: env vars → keytar fallback
//   7. LocalSession create + send a probe prompt
// ---------------------------------------------------------------------------
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const OK   = '\x1b[32m✔\x1b[0m';
const FAIL = '\x1b[31m✘\x1b[0m';
const INFO = '\x1b[36mℹ\x1b[0m';

function pass(msg)  { console.log(OK  + '  ' + msg); }
function fail(msg)  { console.log(FAIL + '  ' + msg); }
function info(msg)  { console.log(INFO + '  ' + msg); }
function head(msg)  { console.log('\n\x1b[1m' + msg + '\x1b[0m'); }

// ── 1. Runtime ──────────────────────────────────────────────────────────────
head('1. Runtime');
info('Node.js ' + process.version + '  ' + process.platform + '-' + process.arch);
info('cwd: ' + process.cwd());

// ── 2. @github/copilot location ─────────────────────────────────────────────
head('2. @github/copilot package');

function findCopilotRoot() {
  const candidates = [
    '/usr/local/lib/node_modules/@github/copilot',
    '/usr/lib/node_modules/@github/copilot',
    path.join(os.homedir(), '.npm', 'node_modules', '@github', 'copilot'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@github', 'copilot'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { return c; }
  }
  // Fallback: try `which copilot` and walk up
  try {
    const which = require('child_process').execSync('which copilot 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which) {
      // e.g. /usr/local/bin/copilot → /usr/local/lib/node_modules/@github/copilot
      const prefix = path.dirname(path.dirname(which));
      const c = path.join(prefix, 'lib', 'node_modules', '@github', 'copilot');
      if (fs.existsSync(c)) { return c; }
    }
  } catch { /* ignore */ }
  return null;
}

const npmRoot = findCopilotRoot();
if (npmRoot) {
  pass('Found at ' + npmRoot);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(npmRoot, 'package.json'), 'utf8'));
    info('Version: ' + pkg.version);
  } catch { /* ignore */ }
} else {
  fail('Not found in any standard location');
  fail('Run: npm install -g @github/copilot-cli  OR  sudo npm install -g @github/copilot-cli');
  process.exit(1);
}

// ── 3. SDK entry point ───────────────────────────────────────────────────────
head('3. SDK entry point');
const sdkPath = path.join(npmRoot, 'sdk', 'index.js');
if (fs.existsSync(sdkPath)) {
  pass('sdk/index.js  ' + sdkPath);
} else {
  fail('sdk/index.js NOT FOUND at ' + sdkPath);
  // List what is in the package root
  try {
    info('Contents of ' + npmRoot + ': ' + fs.readdirSync(npmRoot).join(', '));
  } catch { /* ignore */ }
}

// ── 4. pty.node native binary ────────────────────────────────────────────────
head('4. pty.node native binary');
const prebuildDir = path.join(npmRoot, 'prebuilds');
if (fs.existsSync(prebuildDir)) {
  const dirs = fs.readdirSync(prebuildDir);
  info('Prebuild dirs: ' + (dirs.join(', ') || '(empty)'));
  const target = process.platform + '-' + process.arch;
  const targetDir = path.join(prebuildDir, target);
  if (fs.existsSync(targetDir)) {
    const files = fs.readdirSync(targetDir);
    info(target + ' files: ' + files.join(', '));
    if (files.some(f => f.endsWith('.node'))) {
      pass('Native binary present for ' + target);
    } else {
      fail('No .node file in ' + targetDir + ' — run: cd ' + npmRoot + ' && npm rebuild');
    }
  } else {
    fail('No prebuild dir for ' + target + ' — run: cd ' + npmRoot + ' && npm rebuild');
    info('Available platforms: ' + dirs.join(', '));
  }
} else {
  fail('No prebuilds directory at ' + prebuildDir);
}

// Also check build/Release
const buildRelease = path.join(npmRoot, 'build', 'Release', 'pty.node');
const buildDebug   = path.join(npmRoot, 'build', 'Debug',   'pty.node');
if (fs.existsSync(buildRelease)) { pass('build/Release/pty.node exists'); }
else if (fs.existsSync(buildDebug)) { pass('build/Debug/pty.node exists'); }
else { info('No build/Release/pty.node (will use prebuilds or fail)'); }

// ── 5. Dynamic import of the SDK ─────────────────────────────────────────────
head('5. Dynamic SDK import');
(async () => {
  const sdkUrl = 'file://' + sdkPath;
  let sdkModule;
  try {
    sdkModule = await import(sdkUrl);
    pass('SDK imported successfully');
    info('Exports: ' + Object.keys(sdkModule).join(', '));
  } catch (e) {
    fail('SDK import failed: ' + e.message);
    if (e.message && e.message.includes('pty.node')) {
      fail('pty.node is missing or wrong arch — rebuild it:');
      fail('  cd ' + npmRoot);
      fail('  apt-get install -y build-essential python3 && npm rebuild');
    }
    process.exit(1);
  }

  // ── 6. Auth ───────────────────────────────────────────────────────────────
  head('6. GitHub token / auth');
  const token =
    process.env.COPILOT_GITHUB_TOKEN ||
    process.env.GITHUB_COPILOT_GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN;

  if (token) {
    pass('Token found in env (' + Object.keys(process.env).find(k =>
      process.env[k] === token && k.includes('TOKEN')) + ')');
    info('Token prefix: ' + token.slice(0, 8) + '…');
  } else {
    fail('No GITHUB_TOKEN / GH_TOKEN env var set');
    fail('Run: export GITHUB_TOKEN=ghp_…   or set copilotGithubToken in .autodev/settings.json');
    process.exit(1);
  }

  // Verify token works with Copilot API and capture copilotUser (required by LocalSession)
  let copilotUser;
  try {
    const res = await fetch('https://api.github.com/copilot_internal/user', {
      headers: { Authorization: 'token ' + token, 'User-Agent': 'GitHubCopilotCLI/1.0' },
    });
    if (res.ok) {
      copilotUser = await res.json();
      pass('Token valid — GitHub Copilot user: ' + JSON.stringify(copilotUser).slice(0, 120));
    } else {
      fail('Token rejected by Copilot API: HTTP ' + res.status);
      const body = await res.text();
      info('Response: ' + body.slice(0, 200));
      process.exit(1);
    }
  } catch (e) {
    fail('Copilot API call failed: ' + e.message);
    process.exit(1);
  }

  // ── 7. LocalSession probe ─────────────────────────────────────────────────
  head('7. LocalSession probe (short prompt)');
  const { LocalSession, createCoreServices } = sdkModule;
  if (!LocalSession) {
    fail('LocalSession not exported by the SDK');
    return;
  }

  const authInfo = {
    type: 'gh-cli',
    host: 'https://github.com',
    login: copilotUser?.login ?? 'unknown',
    token,
    copilotUser,
  };

  // SDK v1.0.48+ uses two-arg constructor: LocalSession(coreServices, options).
  // Passing everything as one arg silently ignores authInfo — causing session.error.
  const coreServices = createCoreServices ? createCoreServices({}) : {};

  let session;
  try {
    session = new LocalSession(coreServices, {
      authInfo,
      workingDirectory: process.cwd(),
      runningInInteractiveMode: false,
      askUserDisabled: true,
    });
    pass('LocalSession created');
  } catch (e) {
    fail('LocalSession constructor failed: ' + e.message);
    return;
  }

  info('Sending probe prompt "Reply with: ok"…');
  let responseText = '';
  let errorFired   = false;

  session.on('*', ev => {
    if (!ev.ephemeral) {
      process.stdout.write('  [event] ' + ev.type + '\n');
    }
    if (ev.type === 'session.error') {
      errorFired = true;
      const detail = JSON.stringify(ev.data ?? {});
      fail('session.error: ' + detail);
      const msg = String(ev.data?.message ?? '');
      if (msg.includes('Personal Access Tokens are not supported')) {
        fail('');
        fail('TOKEN TYPE: The token is a classic PAT (ghp_*). The Copilot SDK requires');
        fail('           an OAuth token (gho_*) with the "copilot" scope.');
        fail('');
        info('Fix on the headless machine:');
        info('  1. unset GH_TOKEN');
        info('  2. gh auth refresh -h github.com --scopes copilot   (device flow — visit URL)');
        info('  3. gh auth token -h github.com   → copy the gho_* token');
        info('  4. Set copilotGithubToken in AutoDev extension settings to that gho_* token');
      }
    }
    if (ev.type === 'assistant.message_delta' && ev.data?.deltaContent) {
      responseText += ev.data.deltaContent;
    }
    if (ev.type === 'assistant.message' && ev.data?.content && !responseText) {
      responseText = ev.data.content;
    }
  });

  const done = new Promise(resolve => {
    session.on('session.idle',          () => resolve('session.idle'));
    session.on('session.task_complete', () => resolve('session.task_complete'));
    setTimeout(() => resolve('timeout'), 30000);
  });

  try {
    await session.send({ prompt: 'Reply with exactly the word: ok' });
    const why = await done;
    if (errorFired) {
      fail('Probe completed via ' + why + ' but session.error was fired');
      info('See the session.error message above for specific guidance.');
    } else if (why === 'timeout') {
      fail('Probe timed out after 30s — no session.idle fired');
    } else {
      pass('Probe completed via ' + why);
      info('Response: ' + responseText.trim().slice(0, 200));
    }
  } catch (e) {
    fail('session.send() threw: ' + e.message);
  } finally {
    try { session.dispose(); } catch { /* ignore */ }
  }

  console.log('\n\x1b[1mDone.\x1b[0m');
})().catch(e => {
  fail('Unexpected error: ' + e.message);
  process.exit(1);
});
