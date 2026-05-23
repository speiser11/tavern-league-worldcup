/**
 * leaderboard.js — Leaderboard DOM rendering
 *
 * Expects the scoring engine (app.js) to call renderLeaderboard(standings)
 * after scores are computed.
 *
 * standings: Array of {
 *   teamName: string,
 *   total: number,
 *   playerBreakdowns: Array<{ name, position, total, breakdown }>
 * }
 */

function renderLeaderboard(standings) {
  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '';

  if (!standings.length) {
    container.innerHTML = '<p class="loading">No standings yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'leaderboard-table';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Fantasy leaderboard');

  // Header
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">#</th>
        <th scope="col">Team</th>
        <th scope="col">Best player</th>
        <th scope="col" style="text-align:right">Pts</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  standings.forEach((entry, idx) => {
    const rank = idx + 1;
    const rankClass = rank <= 3 ? ` rank-${rank}` : '';

    // Find top scorer in this team's picks
    const top = [...entry.playerBreakdowns].sort((a, b) => b.total - a.total)[0];
    const topStr = top
      ? `${top.name} <span class="team-name">(${top.total} pts)</span>`
      : '—';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="rank${rankClass}">${rank}</td>
      <td>
        <span class="player-name">${escHtml(entry.teamName)}</span>
      </td>
      <td>${topStr}</td>
      <td class="score">${entry.total}</td>
    `;

    // Expandable breakdown on click
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => toggleBreakdown(row, entry));

    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

function toggleBreakdown(row, entry) {
  const existingDetail = row.nextElementSibling;
  if (existingDetail && existingDetail.classList.contains('breakdown-row')) {
    existingDetail.remove();
    return;
  }

  const detail = document.createElement('tr');
  detail.className = 'breakdown-row';

  const cell = document.createElement('td');
  cell.setAttribute('colspan', '4');
  cell.style.padding = '0.5rem 1rem 1rem 3rem';

  const playerRows = entry.playerBreakdowns
    .sort((a, b) => b.total - a.total)
    .map(p => {
      const bk = Object.entries(p.breakdown)
        .map(([k, v]) => `${formatKey(k)}: ${v > 0 ? '+' : ''}${v}`)
        .join(' · ');
      return `
        <div style="display:flex;justify-content:space-between;padding:0.25rem 0;font-size:0.85rem;border-bottom:1px solid var(--border)">
          <span>
            <strong>${escHtml(p.name)}</strong>
            <span style="color:var(--text-muted);margin-left:0.5rem">${p.position}</span>
            <span style="color:var(--text-muted);font-size:0.75rem;margin-left:0.75rem">${bk || 'No stats yet'}</span>
          </span>
          <span style="font-weight:700">${p.total}</span>
        </div>
      `;
    })
    .join('');

  cell.innerHTML = playerRows;
  detail.appendChild(cell);
  row.after(detail);
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatKey(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
