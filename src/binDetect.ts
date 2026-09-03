// ---------------------------------------------------------------------------
// binDetect — cross-platform resolution of a provider CLI executable.
//
// The sidebar's Step-0 readiness probe used to be Unix-only: it ran
// `${SHELL||bash} -lc "command -v claude"`. On Windows there is no $SHELL,
// `command -v` is a POSIX shell builtin cmd.exe/PowerShell don't have, and the
// binary on disk is `claude.exe` (or a `claude.cmd`/`claude.bat` npm shim), not
// a bare `claude`. So a perfectly-installed Windows user (e.g.
// `C:\Users\user\.local\bin\claude.exe`) was reported as "not installed" and
// kept getting the install-Claude banner.
//
// This module resolves the executable by probing well-known install dirs and
// PATH directly on the filesystem, honoring the platform's executable
// extensions (.exe/.cmd/.bat + PATHEXT on Windows). It is written as a pure
// function whose platform, environment, home directory and filesystem access
// are all injected, so it can be unit-tested for win32 from a Linux CI host.
// ---------------------------------------------------------------------------

import * as path from 'path';

export interface BinDetectDeps {
  /** e.g. process.platform */
  platform: NodeJS.Platform;
  /** e.g. process.env */
  env: NodeJS.ProcessEnv;
  /** e.g. os.homedir() */
  homedir: string;
  /** e.g. fs.existsSync — injected so the resolver is pure/testable */
  fileExists: (p: string) => boolean;
}

/**
 * Executable file extensions to probe when searching for `bin`.
 * Unix: just the bare name (`['']`).
 * Windows: `.exe`/`.cmd`/`.bat` (the shapes an agent CLI actually ships as)
 * unioned with PATHEXT so odd setups still resolve.
 */
export function execExtensions(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') { return ['']; }
  const pathext = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  // Always probe the common CLI shim shapes first, even if PATHEXT is unusual.
  const wanted = ['.exe', '.cmd', '.bat'];
  return [...new Set([...wanted, ...pathext])];
}

/**
 * Well-known install directories to probe (in priority order), before PATH.
 * `claude` (and other agent CLIs) install to `~/.local/bin` on every platform;
 * npm-global shims land in `%APPDATA%\npm` on Windows.
 */
export function knownBinDirs(d: BinDetectDeps): string[] {
  const P = d.platform === 'win32' ? path.win32 : path.posix;
  const dirs: string[] = [];
  // User-local install — where the official `claude` installer drops the binary
  // on all platforms (Windows: %USERPROFILE%\.local\bin\claude.exe).
  dirs.push(P.join(d.homedir, '.local', 'bin'));
  if (d.platform === 'win32') {
    const appdata = d.env.APPDATA;
    const localappdata = d.env.LOCALAPPDATA;
    const programFiles = d.env.ProgramFiles || d.env['ProgramW6432'];
    if (appdata) { dirs.push(P.join(appdata, 'npm')); }             // npm install -g shims
    if (localappdata) {
      dirs.push(P.join(localappdata, 'npm'));
      dirs.push(P.join(localappdata, 'Programs', 'claude'));         // possible native installer
    }
    if (programFiles) { dirs.push(P.join(programFiles, 'nodejs')); } // global npm bundled w/ node
  } else {
    dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', P.join(d.homedir, 'bin'));
  }
  return dirs;
}

/** PATH directories, split with the platform's delimiter (`;` on Windows). */
export function pathDirs(d: BinDetectDeps): string[] {
  // Windows env var casing is unpredictable; check the usual spellings.
  const raw = d.env.PATH ?? d.env.Path ?? (d.env as Record<string, string | undefined>)['path'] ?? '';
  const delim = d.platform === 'win32' ? ';' : ':';
  return raw
    .split(delim)
    .map(s => s.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

/**
 * Resolve the absolute path of an executable named `bin` by probing well-known
 * install dirs then PATH, honoring platform executable extensions
 * (.exe/.cmd/.bat + PATHEXT on Windows). Pure: filesystem access is injected,
 * so it is unit-testable for any platform. Returns the resolved absolute path,
 * or null if not found.
 */
export function detectBinPath(bin: string, d: BinDetectDeps): string | null {
  const P = d.platform === 'win32' ? path.win32 : path.posix;
  const exts = execExtensions(d.platform, d.env);
  const dirs = [...knownBinDirs(d), ...pathDirs(d)];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) { continue; }
    seen.add(dir);
    for (const ext of exts) {
      const candidate = P.join(dir, bin + ext);
      if (d.fileExists(candidate)) { return candidate; }
    }
  }
  return null;
}
