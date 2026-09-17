import { getActiveSubject, subjectLabel, TERMS, TERM_LABELS } from './state.js';
import { computeTermGrade, computeFinalGrade, letterGrade } from './grading.js';
import { escapeHtml } from './utils.js';

let search = '';

export function initReports() {
  document.getElementById('studentSearchReports').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderReports();
  });

  document.getElementById('printBtn').addEventListener('click', () => window.print());
}

export function renderReports() {
  const active = getActiveSubject();
  const list = document.getElementById('reportList');
  const empty = document.getElementById('reportEmpty');

  document.getElementById('reportSub').textContent = active
    ? `${subjectLabel(active)} — term grades and the equal-thirds final. Final shows once all three terms have grades.`
    : '';

  if (!active || !active.students.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'Nothing to report yet — add students, categories, and scores first.';
    return;
  }

  const filtered = active.students.filter(s => s.name.toLowerCase().includes(search));
  if (!filtered.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = 'No students match your search.';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = filtered.map(s => {
    const { final } = computeFinalGrade(active, s.id);
    const lg = letterGrade(final);
    const breakdown = TERMS
      .map(t => {
        const g = computeTermGrade(active, t, s.id).final;
        return `${TERM_LABELS[t]}: ${g !== null ? g.toFixed(1) + '%' : '—'}`;
      })
      .join('  ·  ');

    return `<div class="grade-card">
      <div>
        <div class="name">${escapeHtml(s.name)}${s.remarksOverride ? ` <span style="color:var(--warn);font-weight:600;">— ${escapeHtml(s.remarksOverride.toUpperCase())}</span>` : ''}</div>
        <div class="breakdown">${breakdown}</div>
      </div>
      <div style="text-align:right;">
        <div class="grade-badge" style="background:${lg.color}22;color:${lg.color};">${final !== null ? final.toFixed(1) + '%' : '—'}</div>
        <div style="font-family:'JetBrains Mono',monospace;font-size:12px;color:${lg.color};margin-top:4px;">${lg.letter}</div>
      </div>
    </div>`;
  }).join('');
}
