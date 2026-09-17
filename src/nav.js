import { renderGradesMatrix } from './grades.js';
import { renderReports } from './reports.js';

const TOPBAR_HINTS = {
  setup: 'Setup — students, categories & assignments',
  grades: 'Grades — enter scores',
  reports: 'Reports — final grades & printable sheet'
};

export function initNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;

      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.page').forEach(p => { p.style.display = 'none'; });
      document.getElementById('page-' + page).style.display = 'block';
      document.getElementById('topbarHint').textContent = TOPBAR_HINTS[page];

      // Pages vary a lot in height (e.g. a tall Setup vs. a short Grades).
      // Without this, staying scrolled down on the old page can leave the
      // sticky sidebar's container shorter than the scroll offset, so part
      // of it ends up stuck above the viewport on the new page.
      window.scrollTo(0, 0);

      // These two are cheap to redraw and always want the latest numbers.
      if (page === 'grades') renderGradesMatrix();
      if (page === 'reports') renderReports();
    });
  });
}
