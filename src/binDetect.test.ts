import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectBinPath, execExtensions, pathDirs } from './binDetect.ts';

// --- Windows: the user's real reality --------------------------------------
// Binary at C:\Users\user\.local\bin\claude.exe, homedir C:\Users\user.
// The old probe (`command -v claude` in bash) missed this entirely.

test('win32: finds claude.exe under %USERPROFILE%\\.local\\bin', () => {
  const homedir = 'C:\\Users\\user';
  const target = 'C:\\Users\\user\\.local\\bin\\claude.exe';
  const resolved = detectBinPath('claude', {
    platform: 'win32',
    env: { PATHEXT: '.COM;.EXE;.BAT;.CMD', PATH: 'C:\\Windows\\system32' },
    homedir,
    fileExists: (p) => p === target,
  });
  assert.equal(resolved, target);
});

test('win32: finds a claude.cmd npm shim under %APPDATA%\\npm', () => {
  const target = 'C:\\Users\\user\\AppData\\Roaming\\npm\\claude.cmd';
  const resolved = detectBinPath('claude', {
    platform: 'win32',
    env: { APPDATA: 'C:\\Users\\user\\AppData\\Roaming', PATH: '' },
    homedir: 'C:\\Users\\user',
    fileExists: (p) => p === target,
  });
  assert.equal(resolved, target);
});

test('win32: resolves via PATH dir + PATHEXT (.exe) when not in a known dir', () => {
  const target = 'D:\\tools\\claude.exe';
  const resolved = detectBinPath('claude', {
    platform: 'win32',
    env: { PATH: 'C:\\Windows;D:\\tools', PATHEXT: '.EXE;.CMD' },
    homedir: 'C:\\Users\\user',
    fileExists: (p) => p === target,
  });
  assert.equal(resolved, target);
});

test('win32: returns null when nothing on disk matches (still shows install banner)', () => {
  const resolved = detectBinPath('claude', {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\system32', PATHEXT: '.EXE;.CMD' },
    homedir: 'C:\\Users\\user',
    fileExists: () => false,
  });
  assert.equal(resolved, null);
});

test('win32: does NOT match a bare extension-less file (must be .exe/.cmd/.bat)', () => {
  // A bare "claude" file with no extension is not executable on Windows.
  const bare = 'C:\\Users\\user\\.local\\bin\\claude';
  const resolved = detectBinPath('claude', {
    platform: 'win32',
    env: { PATH: '', PATHEXT: '.EXE;.CMD;.BAT' },
    homedir: 'C:\\Users\\user',
    fileExists: (p) => p === bare,
  });
  assert.equal(resolved, null);
});

// --- Unix: no regression ----------------------------------------------------

test('linux: still finds ~/.local/bin/claude (bare name)', () => {
  const target = '/home/user/.local/bin/claude';
  const resolved = detectBinPath('claude', {
    platform: 'linux',
    env: { PATH: '/usr/bin:/bin' },
    homedir: '/home/user',
    fileExists: (p) => p === target,
  });
  assert.equal(resolved, target);
});

test('linux: finds /usr/local/bin/claude via known dirs', () => {
  const target = '/usr/local/bin/claude';
  const resolved = detectBinPath('claude', {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    homedir: '/home/user',
    fileExists: (p) => p === target,
  });
  assert.equal(resolved, target);
});

// --- helpers ----------------------------------------------------------------

test('execExtensions: win32 always includes .exe/.cmd/.bat', () => {
  const exts = execExtensions('win32', { PATHEXT: '.COM' });
  assert.ok(exts.includes('.exe'));
  assert.ok(exts.includes('.cmd'));
  assert.ok(exts.includes('.bat'));
  assert.ok(exts.includes('.com')); // from PATHEXT, lowercased
});

test('execExtensions: unix is just the bare name', () => {
  assert.deepEqual(execExtensions('linux', {}), ['']);
});

test('pathDirs: splits on ; for win32 and : for unix', () => {
  assert.deepEqual(pathDirs({ platform: 'win32', env: { PATH: 'A;B;C' }, homedir: '', fileExists: () => false }), ['A', 'B', 'C']);
  assert.deepEqual(pathDirs({ platform: 'linux', env: { PATH: 'A:B:C' }, homedir: '', fileExists: () => false }), ['A', 'B', 'C']);
});
