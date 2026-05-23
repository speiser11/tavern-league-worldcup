# 2026 World Cup Fantasy

Live fantasy leaderboard for the 2026 FIFA World Cup. Each participant picks two national teams; points are earned from group-stage results, advancement, and knockout wins. No frameworks, no build step — pure HTML/CSS/JS deployed to GitHub Pages.

**Live site:** https://loganthein.github.io/worldcup-elite-fantasy/

---

## Setup

### 1. Create a GitHub repo and enable Pages

1. Create a new repo on GitHub (or fork this one)
2. Push the code to the `main` branch
3. Go to **Settings → Pages → Branch: `main` / folder: `/(root)` → Save**

Your site will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/` within a minute.

---

### 2. Create `config.js`

```
copy config.example.js config.js
```

Fill in all four values:

| Key | How to get it |
|---|---|
| `RAPIDAPI_KEY` | Sign up at [rapidapi.com](https://rapidapi.com/api-sports/api/api-football), subscribe to API-Football (free tier), copy the key |
| `GITHUB_TOKEN` | [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token (classic) → check **gist** scope |
| `GIST_ID` | Create a new Gist at [gist.github.com](https://gist.github.com) (any content, any filename) → copy the ID from the URL |
| `GIST_FILENAME` | Leave as `worldcup-matches.json` unless you want a different name |

`config.js` is listed in `.gitignore` so your keys stay local. The only exception: if you're deploying to GitHub Pages directly (no CI), you'll need `config.js` in the repo. See the **Deployment** note below.

---

### 3. Initialize the Gist cache

Run once before first deploy:

```
node seedGist.js
```

This writes an empty `{ fetchedAt: 0, matches: [] }` to your Gist. The app uses the Gist as a cross-device fallback cache when the API quota is exhausted or unavailable.

Requires **Node 18+** (uses built-in `fetch`).

---

### 4. Test locally

Open `index.html` directly in a browser — no local server needed. On first load it will call API-Football, populate the leaderboard, and write the results to your Gist cache.

If you see `Error` in the header badge, check the browser console for the specific failure (bad API key, wrong Gist ID, etc.).

---

### 5. Deploy

Double-click `deploy.bat`, or run it from the terminal:

```
deploy.bat
```

This runs:
```bat
git add .
git commit -m "Update <date> <time>"
git push origin main
```

GitHub Pages rebuilds automatically — typically live within 30–60 seconds.

---

## How scoring works

Each participant picks **two national teams**. Points accumulate as the tournament progresses.

### Group stage

| Event | Tier A teams | Tier B teams |
|---|---|---|
| Win | +2 pts | +4 pts (+2 bonus) |
| Draw | +1 pt | +1 pt |
| Loss | 0 | 0 |

**Tier A** (no bonus): Spain, France, England, Brazil, Argentina, Portugal, Germany, Netherlands  
**Tier B** (all others): +2 bonus per win

### Advancement & knockout

| Event | Points |
|---|---|
| Advance from group stage | +3 |
| Round of 32 win | +4 |
| Round of 16 win | +6 |
| Quarterfinal win | +8 |
| Semifinal win | +10 |
| Win the championship | +15 |

Tiebreaker: total group-stage wins.

---

## Participants

Defined in the `PARTICIPANTS` object in `app.js`:

| Participant | Team 1 | Team 2 |
|---|---|---|
| Ashleigh | Brazil | Canada |
| Baker | Germany | Croatia |
| Chad | Japan | Paraguay |
| Jackie | Morocco | Sweden |
| Jake | Argentina | Australia |
| Joren | Norway | Scotland |
| Keillor | France | Uruguay |
| Kyle | England | Senegal |
| Logan | USA | Switzerland |
| Patrick | Portugal | Austria |
| Sara | Spain | Mexico |
| TJ | Colombia | Turkey |
| Tom Moran | Belgium | South Korea |
| Goon | Netherlands | Ecuador |

To add or change participants, edit `PARTICIPANTS` in `app.js`.

---

## How it works

### Data flow

```
Page load
  │
  ├─ localStorage cache fresh? ──yes──▶ render from cache
  │
  ├─ API-Football ──success──▶ render + update localStorage + update Gist
  │
  └─ API failed?
       ├─ stale localStorage ──▶ render from stale cache
       └─ GitHub Gist ──▶ render from Gist fallback
```

- **Live match detected**: re-fetch every 5 minutes
- **No live match**: re-fetch every 60 minutes
- Countdown shown in footer

### File structure

```
worldcup-elite-fantasy/
├── index.html          # UI shell + script loading
├── style.css           # Dark sports-dashboard theme (Bebas Neue + Inter)
├── app.js              # Data structures, data layer, scoring engine
├── leaderboard.js      # DOM rendering, rank deltas, countdown
├── config.js           # Your keys (gitignored)
├── config.example.js   # Template — safe to commit
├── seedGist.js         # One-time Gist initialization script
├── deploy.bat          # Windows one-click deploy
└── .gitignore
```

### Caching

| Layer | TTL | Purpose |
|---|---|---|
| `localStorage` | 5 min (live) / 60 min (idle) | Fast, per-browser cache |
| GitHub Gist | Written on each API fetch | Cross-device fallback when quota is exhausted |

---

## Deployment note

`config.js` is gitignored by default. If you are deploying **directly to GitHub Pages** (no build server), you need `config.js` in the repo so the browser can load it. The repo currently has it committed — just be aware your API keys are publicly visible in the source. For a private setup, consider a serverless proxy instead.
