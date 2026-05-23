# World Cup Fantasy 2026

Live fantasy leaderboard for the 2026 FIFA World Cup. No frameworks, no build step — just vanilla JS deployed to GitHub Pages.

## How it works

| Layer | File | Role |
|---|---|---|
| Data | `app.js` | Fetches match results from API-Football; caches to a GitHub Gist |
| Scoring | `app.js` | Converts raw player stats into fantasy points |
| Rendering | `leaderboard.js` | Builds the leaderboard table; `app.js` renders match cards |
| Styles | `style.css` | Dark-theme, no dependencies |
| Config | `config.js` | API keys & roster (gitignored) |

**Data flow:**
1. On page load, check the GitHub Gist cache.
2. If the cache is fresh (< `CACHE_TTL_MS`), use it — no API call needed.
3. If stale or missing, call API-Football and refresh the cache.
4. If the API fails (quota exhausted, network error) and a stale cache exists, fall back to it gracefully.

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/worldcup-fantasy.git
cd worldcup-fantasy
```

### 2. Create `config.js`

```bash
cp config.example.js config.js
```

Fill in the values:

| Key | Where to get it |
|---|---|
| `RAPIDAPI_KEY` | [RapidAPI → API-Football](https://rapidapi.com/api-sports/api/api-football) |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Personal access tokens (needs `gist` scope) |
| `GIST_ID` | Create a new Gist at [gist.github.com](https://gist.github.com), copy the ID from the URL |

### 3. Edit your roster

Open `config.js` and update the `ROSTER` array. Player names must match the names returned by API-Football exactly.

```js
const ROSTER = [
  {
    teamName: 'Your Team Name',
    picks: [
      { name: 'Kylian Mbappé', position: 'F' },
      // ...
    ],
  },
];
```

Position codes: `G` Goalkeeper · `D` Defender · `M` Midfielder · `F` Forward

### 4. Deploy to GitHub Pages

Push to `main` and enable Pages in the repo settings (branch: `main`, root `/`). Done — no build step needed.

## Scoring rules

Points are defined in `SCORING_RULES` inside `app.js`. Defaults:

| Event | Points |
|---|---|
| Goal (forward) | +6 |
| Goal (midfielder) | +5 |
| Goal (defender / GK) | +6 / +10 |
| Assist | +3 |
| Clean sheet (GK) | +6 |
| Clean sheet (DEF) | +4 |
| Per 3 saves (GK) | +1 |
| Appearance | +1 |
| 60+ minutes played | +1 |
| Yellow card | −1 |
| Red card | −3 |
| Own goal | −2 |
| Penalty saved | +5 |
| Penalty missed | −2 |

Click any row in the leaderboard to expand the per-player point breakdown.

## Development

Open `index.html` directly in a browser — no server required (Gist reads are CORS-safe; API calls require `config.js` to be populated).

For live-reload during development:

```bash
npx serve .
```

## File structure

```
worldcup-fantasy/
├── index.html          # Entry point / leaderboard UI
├── style.css           # Dark-theme styles
├── app.js              # Scoring engine + data layer
├── leaderboard.js      # Leaderboard DOM rendering
├── config.js           # Secrets & roster (gitignored)
├── config.example.js   # Template — safe to commit
└── .gitignore
```
