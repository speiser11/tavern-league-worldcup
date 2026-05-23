#!/usr/bin/env node
/**
 * seedGist.js — Initialize (or reset) the GitHub Gist used as a cache fallback.
 *
 * Run once before first deploy:
 *   node seedGist.js
 *
 * Reads GITHUB_TOKEN, GIST_ID, and GIST_FILENAME from config.js.
 * Writes an empty match cache to the Gist so the app has something to read
 * on first load before the API is called.
 *
 * Requires Node 18+ (uses built-in fetch). For older Node, swap to https module.
 */

const fs   = require('fs');
const path = require('path');

// ── Read config.js ─────────────────────────────────────────────────────────────

const configPath = path.join(__dirname, 'config.js');

if (!fs.existsSync(configPath)) {
  console.error('ERROR: config.js not found.');
  console.error('       Copy config.example.js → config.js and fill in your values first.');
  process.exit(1);
}

const configText = fs.readFileSync(configPath, 'utf8');

function extract(key) {
  const m = configText.match(new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`));
  return m ? m[1] : null;
}

const GITHUB_TOKEN  = extract('GITHUB_TOKEN');
const GIST_ID       = extract('GIST_ID');
const GIST_FILENAME = extract('GIST_FILENAME') || 'worldcup-matches.json';

if (!GITHUB_TOKEN) {
  console.error('ERROR: GITHUB_TOKEN is empty in config.js.');
  console.error('       Create a token at github.com/settings/tokens with the "gist" scope.');
  process.exit(1);
}

if (!GIST_ID) {
  console.error('ERROR: GIST_ID is empty in config.js.');
  console.error('       Create a Gist at gist.github.com, then copy its ID from the URL.');
  process.exit(1);
}

// ── Seed payload ───────────────────────────────────────────────────────────────

const emptyCache = JSON.stringify({ fetchedAt: 0, matches: [] }, null, 2);

const body = JSON.stringify({
  files: {
    [GIST_FILENAME]: { content: emptyCache },
  },
});

// ── PATCH the Gist ─────────────────────────────────────────────────────────────

(async () => {
  console.log(`Seeding Gist ${GIST_ID} → ${GIST_FILENAME} …`);

  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method:  'PATCH',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept':        'application/vnd.github+json',
      'Content-Type':  'application/json',
      'User-Agent':    'worldcup-elite-fantasy',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`ERROR: GitHub API returned ${res.status}`);
    console.error(text);
    process.exit(1);
  }

  const data = await res.json();
  console.log(`Done.`);
  console.log(`  Gist URL : ${data.html_url}`);
  console.log(`  File     : ${GIST_FILENAME}`);
  console.log(`\nYou can now open index.html or run deploy.bat.`);
})();
