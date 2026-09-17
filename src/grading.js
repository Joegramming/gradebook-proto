/**
 * Pure grade math — no DOM, no state import beyond the TERMS constant.
 *
 * Follows the client's class-record scheme:
 *   category %  = Σ(score) * 50 / Σ(max) + 50      over graded, non-excused
 *                                                   assignments  (50 = floor)
 *   period grade = Σ( category% * weight/100 )      no re-normalisation;
 *                                                   a category with nothing
 *                                                   graded contributes nothing
 *   final grade  = (Prelims + Midterms + Finals) / 3, once all three periods
 *                  have at least one graded assignment
 */
import { TERMS } from './state.js';

/** Transmuted % for one category, or null if the student has nothing graded in it. */
export function computeCategoryPct(subject, termKey, categoryId, studentId) {
  const assignments = subject.terms[termKey].assignments.filter(a => a.categoryId === categoryId);
  let earned = 0;
  let possible = 0;
  for (const a of assignments) {
    const entry = subject.scores[studentId + '_' + a.id];
    if (entry && !entry.excused && entry.score !== null && entry.score !== undefined) {
      earned += Number(entry.score);
      possible += Number(a.max);
    }
  }
  if (possible === 0) return null;
  return earned * 50 / possible + 50;
}

/**
 * Grade for one student in one period.
 * Returns { final, catBreakdown } — `final` is null until at least one
 * category has a graded assignment; each breakdown entry is
 * { name, weight, pct } with pct possibly null.
 */
export function computeTermGrade(subject, termKey, studentId) {
  const catBreakdown = [];
  let grade = 0;
  let anyGraded = false;

  subject.terms[termKey].categories.forEach(cat => {
    const pct = computeCategoryPct(subject, termKey, cat.id, studentId);
    catBreakdown.push({ name: cat.name, weight: cat.weight, pct });
    if (pct !== null) {
      grade += pct * (cat.weight / 100);
      anyGraded = true;
    }
  });

  return { final: anyGraded ? grade : null, catBreakdown };
}

/**
 * Overall grade — equal thirds of the three period grades, shown only once all
 * three periods have a grade.
 * Returns { final, terms: [prelims, midterms, finals] }.
 */
export function computeFinalGrade(subject, studentId) {
  const terms = TERMS.map(t => computeTermGrade(subject, t, studentId).final);
  const final = terms.every(t => t !== null)
    ? (terms[0] + terms[1] + terms[2]) / 3
    : null;
  return { final, terms };
}

export function letterGrade(pct) {
  if (pct === null || pct === undefined) return { letter: '—', color: 'var(--ink-muted)' };
  if (pct >= 90) return { letter: 'A', color: 'var(--good)' };
  if (pct >= 80) return { letter: 'B', color: '#7aa6d6' };
  if (pct >= 70) return { letter: 'C', color: '#eea23f' };
  if (pct >= 60) return { letter: 'D', color: '#e08a4f' };
  return { letter: 'F', color: 'var(--warn)' };
}

/**
 * Final grade (0–100) -> numeric equivalent (1.00–5.00) for the registrar's
 * grade sheet. Matches the school's own "GRADING SYSTEM" table (a photo the
 * client provided) exactly: 99-100 -> 1.00 down to 75-77 -> 3.00 in
 * quarter-point steps, then 72-74 -> 4.00 ("conditional"), then 5.00 for
 * anything below that ("Failed"). 0 ("Dropped") isn't score-derived — see
 * the `remarksOverride` param below.
 */
export const EQUIVALENT_BANDS = [
  [99, 1.00], [96, 1.25], [93, 1.50], [90, 1.75], [87, 2.00],
  [84, 2.25], [81, 2.50], [78, 2.75], [75, 3.00], [72, 4.00]
];

/** Whether a `remarksOverride` string specifically flags the student as dropped. */
export function isDropped(remarksOverride) {
  return (remarksOverride || '').trim().toLowerCase() === 'dropped';
}

/**
 * `remarksOverride` is a free-text manual override (e.g. "Dropped",
 * "Transferred", "LOA") for whatever the registrar needs that isn't just a
 * computed grade — see `gradeRemarks`. The official table only gives a
 * numeric equivalent for one such case ("Dropped" -> 0); anything else
 * overridden has no known number, so it's left blank rather than guessed.
 */
export function gradeEquivalent(finalGrade, remarksOverride) {
  const override = (remarksOverride || '').trim();
  if (override) return isDropped(override) ? 0 : null;
  if (finalGrade === null || finalGrade === undefined) return null;
  const g = Math.round(finalGrade);
  for (const [min, eq] of EQUIVALENT_BANDS) {
    if (g >= min) return eq;
  }
  return 5.00;
}

/**
 * Passed / Conditional / Failed / Incomplete by default, from the rounded
 * final grade so it stays consistent with the "Final Grade" and
 * "Equivalent" columns on the sheet — or `remarksOverride` verbatim
 * (e.g. "Dropped", "Transferred", "LOA") when the teacher has set one; it
 * wins over any computed grade.
 */
export function gradeRemarks(finalGrade, remarksOverride) {
  const override = (remarksOverride || '').trim();
  if (override) return override;
  if (finalGrade === null || finalGrade === undefined) return 'Incomplete';
  const g = Math.round(finalGrade);
  if (g >= 75) return 'Passed';
  if (g >= 72) return 'Conditional';
  return 'Failed';
}
