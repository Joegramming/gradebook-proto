import { describe, it, expect } from 'vitest';
import {
  computeCategoryPct, computeTermGrade, computeFinalGrade, letterGrade,
  gradeEquivalent, gradeRemarks, isDropped
} from './grading.js';

/**
 * subject with one student ("s1"). `terms` maps a term key to
 * { categories, assignments, scores }, where assignments are { id, cat, max }
 * and scores are { "<assignmentId>": number | {score, excused} }.
 */
function makeSubject(terms) {
  const subject = {
    id: 'sub1',
    course: { code: 'ITP 112', name: '', semester: '', schoolYear: '', schedule: '', set: '' },
    students: [{ id: 's1', name: 'Ada' }],
    terms: {
      prelims: { categories: [], assignments: [] },
      midterms: { categories: [], assignments: [] },
      finals: { categories: [], assignments: [] }
    },
    scores: {}
  };
  for (const [termKey, cfg] of Object.entries(terms)) {
    subject.terms[termKey].categories = cfg.categories || [];
    subject.terms[termKey].assignments = (cfg.assignments || []).map(a => ({
      id: a.id, name: a.id, categoryId: a.cat, max: a.max
    }));
    for (const [assignId, v] of Object.entries(cfg.scores || {})) {
      subject.scores['s1_' + assignId] = typeof v === 'object' ? v : { score: v, excused: false };
    }
  }
  return subject;
}

describe('computeCategoryPct (transmuted, 50 floor)', () => {
  const sub = makeSubject({
    prelims: {
      categories: [{ id: 'c1', name: 'Quizzes', weight: 100 }],
      assignments: [
        { id: 'a1', cat: 'c1', max: 10 },
        { id: 'a2', cat: 'c1', max: 10 },
        { id: 'a3', cat: 'c1', max: 10 }
      ],
      scores: { a1: 10, a2: 0, a3: { score: 5, excused: true } }
    }
  });

  it('is earned*50/possible + 50 over graded, non-excused assignments', () => {
    // earned 10, possible 20 (a3 excused) -> 10*50/20 + 50 = 75
    expect(computeCategoryPct(sub, 'prelims', 'c1', 's1')).toBe(75);
  });

  it('is null when nothing in the category is graded', () => {
    const s = makeSubject({
      prelims: { categories: [{ id: 'c1', name: 'Q', weight: 100 }], assignments: [{ id: 'a1', cat: 'c1', max: 10 }] }
    });
    expect(computeCategoryPct(s, 'prelims', 'c1', 's1')).toBeNull();
  });

  it('floors at 50 for a straight zero', () => {
    const s = makeSubject({
      prelims: { categories: [{ id: 'c1', name: 'Q', weight: 100 }], assignments: [{ id: 'a1', cat: 'c1', max: 10 }], scores: { a1: 0 } }
    });
    expect(computeCategoryPct(s, 'prelims', 'c1', 's1')).toBe(50);
  });
});

describe('computeTermGrade', () => {
  it('is null when nothing in the period is graded', () => {
    const sub = makeSubject({
      prelims: {
        categories: [{ id: 'c1', name: 'Quizzes', weight: 100 }],
        assignments: [{ id: 'a1', cat: 'c1', max: 10 }]
      }
    });
    const { final, catBreakdown } = computeTermGrade(sub, 'prelims', 's1');
    expect(final).toBeNull();
    expect(catBreakdown).toEqual([{ name: 'Quizzes', weight: 100, pct: null }]);
  });

  it('sums category% * weight/100 across graded categories', () => {
    const sub = makeSubject({
      prelims: {
        categories: [
          { id: 'c1', name: 'Class standing', weight: 40 },
          { id: 'c2', name: 'Exam', weight: 60 }
        ],
        assignments: [
          { id: 'a1', cat: 'c1', max: 100 },
          { id: 'a2', cat: 'c2', max: 100 }
        ],
        scores: { a1: 90, a2: 70 }
        // c1 pct = 90*50/100+50 = 95 ; c2 pct = 70*50/100+50 = 85
        // grade = 95*0.4 + 85*0.6 = 38 + 51 = 89
      }
    });
    expect(computeTermGrade(sub, 'prelims', 's1').final).toBeCloseTo(89, 10);
  });

  it('does NOT re-normalise — an ungraded category just contributes nothing', () => {
    const sub = makeSubject({
      prelims: {
        categories: [
          { id: 'c1', name: 'A', weight: 30 },
          { id: 'c2', name: 'B', weight: 30 },
          { id: 'c3', name: 'C', weight: 40 }
        ],
        assignments: [
          { id: 'a1', cat: 'c1', max: 100 },
          { id: 'a2', cat: 'c2', max: 100 },
          { id: 'a3', cat: 'c3', max: 100 }
        ],
        scores: { a1: 100 } // only c1 -> pct 100 -> grade = 100 * 0.30 = 30
      }
    });
    expect(computeTermGrade(sub, 'prelims', 's1').final).toBeCloseTo(30, 10);
  });

  it('keeps each period independent', () => {
    const sub = makeSubject({
      prelims: { categories: [{ id: 'p', name: 'Q', weight: 100 }], assignments: [{ id: 'pa', cat: 'p', max: 10 }], scores: { pa: 10 } },
      midterms: { categories: [{ id: 'm', name: 'Q', weight: 100 }], assignments: [{ id: 'ma', cat: 'm', max: 10 }], scores: { ma: 0 } }
    });
    expect(computeTermGrade(sub, 'prelims', 's1').final).toBe(100); // 10*50/10+50
    expect(computeTermGrade(sub, 'midterms', 's1').final).toBe(50); // 0*50/10+50
  });
});

describe('computeFinalGrade', () => {
  // each term gets its own assignment id so scores don't collide
  const oneCatTerm = (aid, score) => ({
    categories: [{ id: 'c_' + aid, name: 'Q', weight: 100 }],
    assignments: [{ id: aid, cat: 'c_' + aid, max: 100 }],
    scores: score === null ? {} : { [aid]: score }
  });

  it('is null until all three periods have a grade', () => {
    expect(computeFinalGrade(makeSubject({ prelims: oneCatTerm('pa', 80) }), 's1').final).toBeNull();
    expect(computeFinalGrade(makeSubject({ prelims: oneCatTerm('pa', 80), midterms: oneCatTerm('ma', 80) }), 's1').final).toBeNull();
  });

  it('is the equal-thirds average once all three are graded', () => {
    // pcts: 100*50/100+50=100 ; 80->90 ; 60->80
    const sub = makeSubject({
      prelims: oneCatTerm('pa', 100),
      midterms: oneCatTerm('ma', 80),
      finals: oneCatTerm('fa', 60)
    });
    const { final, terms } = computeFinalGrade(sub, 's1');
    expect(terms).toEqual([100, 90, 80]);
    expect(final).toBeCloseTo((100 + 90 + 80) / 3, 10);
  });
});

describe('gradeEquivalent (school\'s official table)', () => {
  it('maps null (no final grade) to null', () => {
    expect(gradeEquivalent(null)).toBeNull();
  });

  it.each([
    [100, 1.00], [99, 1.00], [96, 1.25], [93, 1.50], [90, 1.75],
    [87, 2.00], [84, 2.25], [81, 2.50], [78, 2.75], [75, 3.00],
    [74, 4.00], [72, 4.00], [71, 5.00], [60, 5.00], [0, 5.00]
  ])('final %d -> %f', (final, eq) => {
    expect(gradeEquivalent(final)).toBe(eq);
  });

  it('rounds the final grade before banding', () => {
    expect(gradeEquivalent(89.6)).toBe(1.75); // rounds to 90
    expect(gradeEquivalent(89.4)).toBe(2.00); // rounds to 89
  });

  it('an overridden "Dropped" remark is equivalent 0, regardless of any computed grade', () => {
    expect(gradeEquivalent(95, 'Dropped')).toBe(0);
    expect(gradeEquivalent(null, 'Dropped')).toBe(0);
    expect(gradeEquivalent(95, 'dropped')).toBe(0); // case-insensitive
  });

  it('any other override has no known number, so it\'s left blank', () => {
    expect(gradeEquivalent(95, 'Transferred')).toBeNull();
    expect(gradeEquivalent(null, 'LOA')).toBeNull();
  });

  it('a blank/whitespace-only override is not an override', () => {
    expect(gradeEquivalent(100, '   ')).toBe(1.00);
  });
});

describe('gradeRemarks', () => {
  it('is Incomplete without a final grade', () => {
    expect(gradeRemarks(null)).toBe('Incomplete');
  });
  it('uses the rounded grade — Passed >= 75, Conditional 72-74, Failed below 72', () => {
    expect(gradeRemarks(74.5)).toBe('Passed');       // rounds to 75
    expect(gradeRemarks(74.4)).toBe('Conditional');   // rounds to 74
    expect(gradeRemarks(72)).toBe('Conditional');
    expect(gradeRemarks(71.4)).toBe('Failed');         // rounds to 71
  });
  it('an override wins over any computed grade, verbatim (trimmed)', () => {
    expect(gradeRemarks(95, 'Dropped')).toBe('Dropped');
    expect(gradeRemarks(null, 'Transferred')).toBe('Transferred');
    expect(gradeRemarks(60, '  LOA  ')).toBe('LOA');
  });
  it('a blank/whitespace-only override is not an override', () => {
    expect(gradeRemarks(80, '   ')).toBe('Passed');
  });
});

describe('isDropped', () => {
  it('matches "Dropped" case-insensitively, trimmed', () => {
    expect(isDropped('Dropped')).toBe(true);
    expect(isDropped('dropped')).toBe(true);
    expect(isDropped('  DROPPED  ')).toBe(true);
  });
  it('does not match a longer note that just happens to contain the word', () => {
    expect(isDropped('Dropped mid-semester, family emergency')).toBe(false);
  });
  it('is false for blank, other overrides, and no value at all', () => {
    expect(isDropped('')).toBe(false);
    expect(isDropped('   ')).toBe(false);
    expect(isDropped('Transferred')).toBe(false);
    expect(isDropped(undefined)).toBe(false);
    expect(isDropped(null)).toBe(false);
  });
});

describe('letterGrade', () => {
  it('maps null to a dash', () => {
    expect(letterGrade(null).letter).toBe('—');
  });

  it.each([
    [100, 'A'], [90, 'A'], [89.99, 'B'], [80, 'B'],
    [70, 'C'], [60, 'D'], [59.99, 'F'], [0, 'F']
  ])('maps %d%% to %s', (pct, letter) => {
    expect(letterGrade(pct).letter).toBe(letter);
  });
});
