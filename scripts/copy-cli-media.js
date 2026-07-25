#!/usr/bin/env node
/**
 * Copy the agent-profile media from the CLI (the single source of truth) into
 * this extension's `media/profile/` before bundling. The profile section files
 * live in `autodev-cli/media/profile/`; the extension bundles the CLI's
 * profileBuilder, which reads media relative to the running bundle
 * (`<bundle>/../media/profile`), so the files must be present on disk here at
 * package time. This dir is gitignored — it is generated, never edited here.
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', '..', 'autodev-cli', 'media', 'profile');
const dest = path.resolve(__dirname, '..', 'media', 'profile');

if (!fs.existsSync(src)) {
  console.error(`copy-cli-media: source not found: ${src} — is autodev-cli checked out beside this repo?`);
  process.exit(1);
}
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.md')) { fs.copyFileSync(path.join(src, f), path.join(dest, f)); n++; }
}
console.log(`copy-cli-media: copied ${n} profile section(s) from CLI → media/profile/`);
