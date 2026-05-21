#!/usr/bin/env node
// ---------------------------------------------------------------------------
// test-grok-tui.js
//
// Exploration script for grok TUI/stdio interface.
// Run: node scripts/test-grok-tui.js
//
// Grok is in beta — this script probes three things:
//   1. Single-turn headless mode (grok -p / --single)
//   2. grok agent stdio — raw protocol discovery (what does stdin expect?)
//   3. grok agent stdio — send a real prompt, observe output format
//
// Available models (from `grok models`):
//   sxs-claude-opus-4-6   <-- Claude-family model (no Sonnet listed; use this)
//   grok-build-0423a-s35  <-- possibly Sonnet-3.5 based build
//   sxs-kimi-k2-5         <-- default
//
// Usage:
//   node scripts/test-grok-tui.js [model]
//   node scripts/test-grok-tui.js sxs-claude-opus-4-6
// ---------------------------------------------------------------------------

'use strict';

const { spawn, execSync } = require('child_process');

// ---- Config ----------------------------------------------------------------
const GROK_BIN = process.env.GROK_BIN || 'grok';
// Use CLI arg or fall back to the Claude-family model (closest to Sonnet)
const MODEL = process.argv[2] || 'sxs-claude-opus-4-6';
const TEST_PROMPT = 'Reply with exactly: GROK_OK model=<your model name>';
const STDIO_TIMEOUT_MS = 20_000;

// ---- Helpers ---------------------------------------------------------------
function log(tag, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [${tag}] ${msg}`);
}
function hr(title) {
  console.log('\n' + '─'.repeat(60));
  console.log('  ' + title);
  console.log('─'.repeat(60));
}

// ============================================================================
// TEST 1 — Single-turn headless  (grok --single / -p)
// ============================================================================
async function testSingleTurn() {
  hr(`TEST 1: Single-turn  (-p)  model=${MODEL}`);

  return new Promise((resolve) => {
    const args = ['-m', MODEL, '-p', TEST_PROMPT];
    log('spawn', `${GROK_BIN} ${args.join(' ')}`);

    const child = spawn(GROK_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });

    const timer = setTimeout(() => {
      log('TIMEOUT', 'Killing single-turn test');
      child.kill();
    }, STDIO_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      log('exit', `code=${code}`);
      log('result', stdout.trim() || '(no stdout)');
      resolve({ stdout, stderr, code });
    });
  });
}

// ============================================================================
// TEST 2 — grok agent stdio: MCP protocol probe
//
//  grok agent stdio speaks JSON-RPC 2.0 / MCP.
//  Probe with correct MCP initialize and sampling/createMessage.
// ============================================================================
async function testStdioProtocol() {
  hr(`TEST 2: grok agent stdio — MCP protocol probe  model=${MODEL}`);

  return new Promise((resolve) => {
    // NOTE: model flag must come BEFORE 'agent' subcommand in grok
    // NOTE: flags like --always-approve also go before 'agent'
    const args = ['-m', MODEL, '--always-approve', 'agent', 'stdio'];
    log('spawn', `${GROK_BIN} ${args.join(' ')}`);

    const child = spawn(GROK_BIN, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const received = [];
    let stdoutBuf = '';

    child.stdout.on('data', (d) => {
      const raw = d.toString();
      stdoutBuf += raw;
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        received.push(line);
        log('stdout-line', line.slice(0, 300));
        try {
          const obj = JSON.parse(line);
          log('parsed', JSON.stringify(obj, null, 2).slice(0, 600));
        } catch {
          // not JSON
        }
      }
    });

    child.stderr.on('data', (d) => {
      process.stderr.write('[stderr] ' + d.toString());
    });

    // MCP handshake: initialize → initialized notification → sampling/createMessage
    const messages = [
      // 1. MCP initialize (required first message)
      JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { sampling: {} },
          clientInfo: { name: 'autodev-test', version: '1.0.0' },
        },
      }),
      // 2. initialized notification (after server responds to initialize)
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      // 3. Try to send a prompt via sampling/createMessage
      JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'sampling/createMessage',
        params: {
          messages: [{ role: 'user', content: { type: 'text', text: TEST_PROMPT } }],
          maxTokens: 512,
        },
      }),
      // 4. Also try roots/list to see what methods are available
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    ];

    let step = 0;
    function sendNext() {
      if (step >= messages.length) {
        setTimeout(() => { log('probe', 'Killing MCP probe'); child.kill(); }, 3000);
        return;
      }
      const msg = messages[step++];
      log('stdin', msg.slice(0, 300));
      child.stdin.write(msg + '\n');
      setTimeout(sendNext, 2000);
    }

    setTimeout(sendNext, 1000);

    const timer = setTimeout(() => {
      log('TIMEOUT', 'Killing stdio probe');
      child.kill();
    }, STDIO_TIMEOUT_MS);

    child.on('close', (code) => {
      clearTimeout(timer);
      log('exit', `code=${code}  lines-received=${received.length}`);
      resolve({ received, code });
    });
  });
}

// ============================================================================
// TEST 3 — single-turn with --always-approve and session continuation
// ============================================================================
async function testSingleTurnContinue() {
  hr(`TEST 3: Session continuation  (-c -p)  model=${MODEL}`);

  return new Promise((resolve) => {
    // First turn sets up a session, second turn continues it
    const args = ['-m', MODEL, '--always-approve', '-p', TEST_PROMPT];
    log('spawn', `${GROK_BIN} ${args.join(' ')}`);

    const child = spawn(GROK_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { process.stderr.write('[stderr] ' + d.toString()); });

    const timer = setTimeout(() => { log('TIMEOUT', 'Killing'); child.kill(); }, STDIO_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      log('exit', `code=${code}`);
      log('result', stdout.trim() || '(no stdout)');

      if (code === 0) {
        // Now try to continue the session
        log('continue', 'Sending follow-up via -c (continue last session)');
        const child2 = spawn(GROK_BIN, ['-m', MODEL, '--always-approve', '-c', '-p', 'What did I just ask you?'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout2 = '';
        child2.stdout.on('data', (d) => { stdout2 += d.toString(); process.stdout.write(d); });
        child2.stderr.on('data', (d) => { process.stderr.write('[cont-stderr] ' + d.toString()); });
        const t2 = setTimeout(() => { child2.kill(); }, STDIO_TIMEOUT_MS);
        child2.on('close', (code2) => {
          clearTimeout(t2);
          log('continue-exit', `code=${code2}`);
          log('continue-result', stdout2.trim() || '(no stdout)');
          resolve({ stdout, stdout2, code, code2 });
        });
      } else {
        resolve({ stdout, code });
      }
    });
  });
}

// ============================================================================
// MAIN
// ============================================================================
(async () => {
  console.log('='.repeat(60));
  console.log('  Grok TUI exploration script');
  console.log(`  Binary : ${GROK_BIN}`);
  console.log(`  Model  : ${MODEL}`);
  console.log('='.repeat(60));

  // Sanity-check grok is available
  try {
    const ver = execSync(`${GROK_BIN} --version 2>&1`, { encoding: 'utf8' }).trim();
    log('grok', `version: ${ver}`);
  } catch (e) {
    console.error(`ERROR: grok binary not found at "${GROK_BIN}"`);
    process.exit(1);
  }

  const r1 = await testSingleTurn();
  const r2 = await testStdioProtocol();
  const r3 = await testSingleTurnContinue();

  hr('SUMMARY');
  console.log('Test 1 (single-turn -p)     exit code :', r1.code);
  console.log('Test 2 (MCP stdio probe)    lines recv:', r2.received.length);
  console.log('Test 3 (session continue)   exit code :', r3.code);
  console.log('\nConclusions:');
  console.log('  - Single-turn: grok -m MODEL --always-approve -p PROMPT');
  console.log('  - Continuation: grok -m MODEL --always-approve -c -p PROMPT');
  console.log('  - stdio protocol: MCP JSON-RPC 2.0 (see test-2 output)');
  console.log('  - model flag MUST come before subcommands');
})();
