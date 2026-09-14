import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildClassRecordBlob, parseClassRecord } from './xlsx.js';

const semester = () => ({ label: 'SECOND SEMESTER', schoolYear: 'SY 2025-2026' });

function subject() {
  const cat = (id, name, weight) => ({ id, name, weight });
  const asg = (id, name, categoryId, max, date) => ({ id, name, categoryId, max, date });
  return {
    id: 'sub1',
    course: {
      code: 'ITP 112', name: 'SYSTEMS ANALYSIS AND DESIGN',
      schedule: 'TTH 3:30-5:30', set: 'SET A',
      courseYear: 'BSIT II-B', instructor: 'HELEN S. DURIGUEZ', programChair: 'ENGR. ELIAS D. EDAN JR.'
    },
    students: [{ id: 's1', name: 'AGUSTIN, EIAN' }, { id: 's2', name: 'ALON, MARLON' }],
    terms: {
      prelims: {
        categories: [cat('c1', 'Class Standing', 40), cat('c2', 'Exam', 60)],
        assignments: [
          asg('a1', 'Attendance', 'c1', 10, '1/12'),
          asg('a2', 'Recitation', 'c1', 10, ''),
          asg('a3', 'Prelim Exam', 'c2', 75, '')
        ]
      },
      midterms: { categories: [], assignments: [] },
      finals: { categories: [], assignments: [] }
    },
    scores: { s1_a1: { score: 9, excused: false }, s1_a3: { score: 60, excused: false } }
  };
}

async function readBack(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.getWorksheet('Class Record');
}

describe('buildClassRecordBlob', () => {
  it('writes the A1:A9 course block (A3/A4 from the semester) and STUDENT header', async () => {
    const ws = await readBack(await buildClassRecordBlob(subject(), semester()));
    expect(ws.getCell('A1').value).toBe('ITP 112');
    expect(ws.getCell('A2').value).toBe('SYSTEMS ANALYSIS AND DESIGN');
    expect(ws.getCell('A3').value).toBe('SECOND SEMESTER');   // semester.label
    expect(ws.getCell('A4').value).toBe('SY 2025-2026');       // semester.schoolYear
    expect(ws.getCell('A6').value).toBe('SET A');
    expect(ws.getCell('A7').value).toBe('BSIT II-B');
    expect(ws.getCell('A9').value).toBe('ENGR. ELIAS D. EDAN JR.');
    expect(ws.getCell('A15').value).toBe('STUDENT');
    expect(ws.getCell('A16').value).toBe('AGUSTIN, EIAN');
  });

  it('separates assignment name (row 13) and date (row 14); max/weight on row 15', async () => {
    const ws = await readBack(await buildClassRecordBlob(subject(), semester()));
    expect(ws.getCell('B13').value).toBe('Attendance');
    expect(ws.getCell('C13').value).toBe('Recitation');
    expect(ws.getCell('B14').value).toBe('1/12');       // date row
    expect(ws.getCell('C14').value).toBeNull();          // no date
    expect(ws.getCell('B15').value).toBe(10);            // max
    expect(ws.getCell('G15').value).toBe(75);
    expect(ws.getCell('F15').value).toBeCloseTo(0.4);    // Class Standing weight
    expect(ws.getCell('J15').value).toBeCloseTo(0.6);    // Exam weight

    expect(ws.getCell('B16').value).toBe(9);             // s1 Attendance score
    expect(ws.getCell('C16').value).toBeNull();          // s1 Recitation ungraded
    expect(ws.getCell('D16').value.formula).toBe('SUM(B16:C16)');
    expect(ws.getCell('K16').value.formula).toBe('F16+J16');   // PRELIMS GRADE
    expect(ws.getCell('N16').value.formula).toContain('/3');   // FINAL GRADE
  });
});

describe('parseClassRecord — round-trip', () => {
  it('rebuilds course, semester hint, students, categories, assignments and scores', async () => {
    const blob = await buildClassRecordBlob(subject(), semester());
    const results = await parseClassRecord(await blob.arrayBuffer());
    expect(results).toHaveLength(1);
    const { subject: draft, warnings } = results[0];
    expect(warnings).toEqual([]);

    expect(draft.course).toEqual(subject().course);
    expect(draft.semesterHint).toEqual({ label: 'SECOND SEMESTER', schoolYear: 'SY 2025-2026' });
    expect(draft.students.map(s => s.name)).toEqual(['AGUSTIN, EIAN', 'ALON, MARLON']);

    const pcats = draft.terms.prelims.categories;
    expect(pcats.map(c => [c.name, c.weight])).toEqual([['Class Standing', 40], ['Exam', 60]]);

    const pasg = draft.terms.prelims.assignments;
    expect(pasg.map(a => [a.name, a.max, a.date])).toEqual([
      ['Attendance', 10, '1/12'],
      ['Recitation', 10, ''],
      ['Prelim Exam', 75, '']
    ]);
    // assignments linked to the right (regenerated) category ids
    const csId = pcats.find(c => c.name === 'Class Standing').id;
    const exId = pcats.find(c => c.name === 'Exam').id;
    expect(pasg.find(a => a.name === 'Attendance').categoryId).toBe(csId);
    expect(pasg.find(a => a.name === 'Prelim Exam').categoryId).toBe(exId);

    expect(draft.terms.midterms.assignments).toEqual([]);
    expect(draft.terms.finals.categories).toEqual([]);

    // scores re-linked by the new ids
    const ada = draft.students.find(s => s.name === 'AGUSTIN, EIAN').id;
    const att = pasg.find(a => a.name === 'Attendance').id;
    const exam = pasg.find(a => a.name === 'Prelim Exam').id;
    expect(draft.scores[`${ada}_${att}`]).toEqual({ score: 9, excused: false });
    expect(draft.scores[`${ada}_${exam}`]).toEqual({ score: 60, excused: false });
    expect(Object.keys(draft.scores)).toHaveLength(2);
  });

  it('rejects a workbook that is not a class record', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').getCell('A1').value = 'hello';
    const buf = await wb.xlsx.writeBuffer();
    await expect(parseClassRecord(buf)).rejects.toThrow();
  });
});

describe('parseClassRecord — legacy (hand-built) sheet', () => {
  // Mimics a teacher's own template: structure is read from the live
  // formulas, not fixed positions. One category ("EXAM") has a single raw
  // item, so its "Total" cell has no SUM formula — the raw cell doubles as
  // the total. The other ("QUIZ") has two items and a real SUM. Only the
  // first student row still carries live %/weighted formulas — the second
  // is plain pasted numbers, like most rows in the real file — and term
  // grouping is inferred from a plain "E11+K11" sum (no "(a+b+c)/3" anchor).
  function buildLegacySheet() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    const set = (r, c, v) => { ws.getCell(r, c).value = v; };
    const formula = (r, c, f) => { ws.getCell(r, c).value = { formula: f }; };

    // course block, A1:A9
    set(1, 1, 'ITP 112');
    set(2, 1, 'SYSTEMS ANALYSIS AND DESIGN');
    set(3, 1, 'SECOND SEMESTER');
    set(4, 1, 'SY 2025-2026');
    set(5, 1, 'TTH 3:30-5:30');
    set(6, 1, 'SET A');
    set(7, 1, 'BSIT II-B');
    set(8, 1, 'HELEN S. DURIGUEZ');
    set(9, 1, 'ENGR. ELIAS D. EDAN JR.');

    // name column header, just above the student rows
    set(10, 1, 'NAMES');

    // EXAM: single item, col C — total cell (C10) is a plain max, no SUM
    set(8, 3, 'EXAM');            // category name (maxRow - 2)
    set(10, 3, 75);               // max (maxRow)
    set(10, 5, 0.4);              // weight decimal

    // QUIZ: two items, cols G:H — Total col I has a real SUM at the max row
    set(8, 7, 'QUIZ');            // category name (maxRow - 2)
    set(10, 7, 10);               // item 1 max
    set(10, 8, 10);               // item 2 max
    formula(10, 9, 'SUM(G10:H10)');
    set(10, 11, 0.6);             // weight decimal

    // student 1 — has live formulas (pct + weighted)
    set(11, 1, 'AGUSTIN, EIAN');
    set(11, 3, 60);                          // exam score (= total, single item)
    formula(11, 4, 'C11*50/$C$10+50');       // exam %
    formula(11, 5, 'D11*$E$10');             // exam weighted
    set(11, 7, 8); set(11, 8, 9);            // quiz item scores
    set(11, 9, 17);                          // quiz total (plain, not a formula)
    formula(11, 10, 'I11*50/$I$10+50');      // quiz %
    formula(11, 11, 'J11*$K$10');            // quiz weighted
    formula(11, 14, 'E11+K11');              // period grade (no "/3" anchor)

    // student 2 — plain pasted values only, no formulas at all in this row
    set(12, 1, 'ALON, MARLON');
    set(12, 3, 70);
    set(12, 7, 7); set(12, 8, 8);
    set(12, 9, 15);

    return wb;
  }

  it('reads categories, weights, sparse-formula student rows and term grouping from formulas alone', async () => {
    const wb = buildLegacySheet();
    const buf = await wb.xlsx.writeBuffer();
    const results = await parseClassRecord(buf);

    expect(results).toHaveLength(1);
    const { subject, warnings } = results[0];

    expect(subject.course.code).toBe('ITP 112');
    expect(subject.semesterHint).toEqual({ label: 'SECOND SEMESTER', schoolYear: 'SY 2025-2026' });

    // both real students found, even though row 12 has no live formulas at all
    expect(subject.students.map(s => s.name)).toEqual(['AGUSTIN, EIAN', 'ALON, MARLON']);

    const pcats = subject.terms.prelims.categories;
    expect(pcats.map(c => [c.name, c.weight]).sort()).toEqual(
      [['EXAM', 40], ['QUIZ', 60]].sort()
    );
    expect(subject.terms.midterms.categories).toEqual([]);
    expect(subject.terms.finals.categories).toEqual([]);

    const examCat = pcats.find(c => c.name === 'EXAM');
    const quizCat = pcats.find(c => c.name === 'QUIZ');
    const examAsg = subject.terms.prelims.assignments.filter(a => a.categoryId === examCat.id);
    const quizAsg = subject.terms.prelims.assignments.filter(a => a.categoryId === quizCat.id);
    expect(examAsg).toHaveLength(1);           // single-item category: total cell IS the item
    expect(examAsg[0].max).toBe(75);
    expect(quizAsg).toHaveLength(2);            // multi-item category: real SUM range
    expect(quizAsg.map(a => a.max)).toEqual([10, 10]);

    // scores pulled for BOTH students, including the one with no live formulas
    const [s1, s2] = subject.students;
    expect(subject.scores[`${s1.id}_${examAsg[0].id}`]).toEqual({ score: 60, excused: false });
    expect(subject.scores[`${s2.id}_${examAsg[0].id}`]).toEqual({ score: 70, excused: false });
    expect(subject.scores[`${s2.id}_${quizAsg[0].id}`].score).toBe(7);
    expect(subject.scores[`${s2.id}_${quizAsg[1].id}`].score).toBe(8);

    expect(warnings.some(w => /didn't create/i.test(w))).toBe(true);
  });
});
