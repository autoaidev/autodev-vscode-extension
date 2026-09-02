#!/usr/bin/env node
/**
 * Copy the agent-profile media from the CLI (the single source of truth) into
 * this extension's `media/profile/` before bundling. The profile section files
 * live in `autodev-cli/media/profile/`; the extension bundles the CLI's
 * profileBuilder, which reads media relative to the running bundle
 * (`<bundle>/../media/profile`), so the files must be present on disk here at
 * package time. This dir is gitignored — it is generated, never edited here.
 *
 * DRIFT GUARD: the destination is cleaned first (so a section removed upstream
 * does not linger) and, after copying, every file named in the CLI's
 * `PROFILE_SECTIONS` must be present — otherwise the build FAILS. This makes a
 * stale/incomplete profile snapshot (e.g. missing the 00a–00i pillars) shipping
 * silently impossible: if the bundled profileBuilder knows about a section, its
 * markdown must have been copied here too.
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'autodev-cli', 'media', 'profile');
const dest = path.resolve(__dirname, '..', 'media', 'profile');

if (!fs.existsSync(src)) {
  console.error(`copy-cli-media: source not found: ${src} — is autodev-cli checked out beside this repo?`);
  process.exit(1);
}

// Start clean so sections removed upstream do not persist as stale artifacts.
if (fs.existsSync(dest)) {
  for (const f of fs.readdirSync(dest)) {
    if (f.endsWith('.md')) { fs.rmSync(path.join(dest, f)); }
  }
}
fs.mkdirSync(dest, { recursive: true });

let n = 0;
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.md')) { fs.copyFileSync(path.join(src, f), path.join(dest, f)); n++; }
}
console.log(`copy-cli-media: copied ${n} profile section(s) from CLI → media/profile/`);

// Parity check against the bundled profileBuilder's section list. Every section
// the extension will try to deploy at runtime must have its md on disk here.
let sections;
try {
  ({ PROFILE_SECTIONS: sections } = require('autodev-cli/profileBuilder'));
} catch (err) {
  console.error(`copy-cli-media: could not load autodev-cli/profileBuilder for the parity check — ${err.message}`);
  process.exit(1);
}
const missing = sections
  .map((s) => s.file)
  .filter((file) => !fs.existsSync(path.join(dest, file)));
if (missing.length > 0) {
  console.error(
    `copy-cli-media: FAIL — ${missing.length} profile section file(s) named in PROFILE_SECTIONS are missing from media/profile/:\n  ${missing.join('\n  ')}\n` +
      `The CLI's profile media is out of sync with the extension. Rebuild/refresh the sibling autodev-cli checkout.`,
  );
  process.exit(1);
}
console.log(`copy-cli-media: parity OK — all ${sections.length} PROFILE_SECTIONS present in media/profile/`);
