/**
 * Grade sheet .docx export — matches `docs/sample-doc`:
 *   - letterhead (logo + institution + document-control box + "GRADE SHEET"),
 *     repeated in the page header
 *   - course-info block
 *   - table: Seq. | Names | Final Grade | Equivalent | Remarks, then
 *     a centred "Nothing Follows" row
 *   - the fixed 6-item instructions list
 *   - "Prepared by" / "Verified by" signature block
 *
 * Final Grade / Equivalent / Remarks come from grading.js.
 */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, VerticalAlign, VerticalMergeType,
  ImageRun, PageNumber, Header
} from 'docx';
import { computeFinalGrade, gradeEquivalent, gradeRemarks } from './grading.js';
import { ASC_LOGO_JPEG_BASE64 } from './asc-logo.js';

const FONT = 'Arial';
const SZ = 20; // 10pt in half-points

const INSTRUCTIONS = [
  'This grading sheet must contain the names of all enrolled students in your class, alphabetically arranged, indicating their Family Name, Given Name & Middle Initial.',
  'No grades are allowed to be changed after the sheet is received at the registrar’s office.',
  'If a student dropped out, indicate the date and reason for dropping in the remarks section.',
  'Please do not leave space before every entry. Write "Nothing follows" in the row after the last entry.',
  'Always fill out the remarks section.',
  'Prepare three (3) original sheets. Copy for instructor, registrar and department head.'
];

const CONTROL = {
  documentCode: 'ASC-HED-IQF-13',
  effectiveDate: '09/23/2024',
  revisionNo: '00'
};

const EDGE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const BORDERED = { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE };
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const BORDERLESS = { top: NONE, bottom: NONE, left: NONE, right: NONE };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const run = (text, opts = {}) => new TextRun({ text: String(text), font: FONT, size: SZ, ...opts });

const para = (text, opts = {}) => new Paragraph({
  alignment: opts.align,
  spacing: opts.spacing,
  children: Array.isArray(text) ? text : [run(text, opts)]
});

function cell(children, { borders = BORDERED, align, width, colSpan, vMerge } = {}) {
  return new TableCell({
    borders,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    columnSpan: colSpan,
    verticalAlign: VerticalAlign.CENTER,
    verticalMerge: vMerge,
    children: (Array.isArray(children) ? children : [children]).map(c =>
      typeof c === 'string' ? para(c, { align }) : c
    )
  });
}

/* ---------- letterhead ---------- */

function letterhead() {
  const w = [4860, 1890, 2340];
  const box = (label, value) => new TableRow({
    children: [
      cell([], { vMerge: VerticalMergeType.CONTINUE, width: w[0] }),
      cell(label, { width: w[1] }),
      cell(value, { width: w[2], align: AlignmentType.CENTER })
    ]
  });

  const brandCell = cell([
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: 'jpg',
        data: b64ToBytes(ASC_LOGO_JPEG_BASE64),
        transformation: { width: 70, height: 70 }
      })]
    }),
    para('Republic of the Philippines', { align: AlignmentType.CENTER }),
    para('APAYAO STATE COLLEGE', { align: AlignmentType.CENTER, bold: true })
  ], { width: w[0], vMerge: VerticalMergeType.RESTART });

  return new Table({
    columnWidths: w,
    width: { size: w[0] + w[1] + w[2], type: WidthType.DXA },
    rows: [
      new TableRow({ children: [brandCell, cell('Document Code:', { width: w[1] }), cell(CONTROL.documentCode, { width: w[2], align: AlignmentType.CENTER })] }),
      box('Effective Date:', CONTROL.effectiveDate),
      box('Revision No.:', CONTROL.revisionNo),
      new TableRow({
        children: [
          cell(para('GRADE SHEET', { align: AlignmentType.CENTER, bold: true }), { width: w[0] }),
          cell('Page No.:', { width: w[1] }),
          cell([new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ font: FONT, size: SZ, bold: true, children: [PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })]
          })], { width: w[2] })
        ]
      })
    ]
  });
}

/* ---------- body pieces ---------- */

function courseInfo(course, semester) {
  const row = (a, b) => new TableRow({
    children: [
      cell(a, { borders: BORDERLESS, width: 5000 }),
      cell(b, { borders: BORDERLESS, width: 5580 })
    ]
  });
  return new Table({
    columnWidths: [5000, 5580],
    width: { size: 10580, type: WidthType.DXA },
    borders: {
      top: NONE, bottom: NONE, left: NONE, right: NONE,
      insideHorizontal: NONE, insideVertical: NONE
    },
    rows: [
      row(`Course Code: ${course.code}`, `Descriptive Title: ${course.name}`),
      row(`Course and Year: ${course.courseYear}`, `Semester: ${semester.label || ''}    School Year: ${semester.schoolYear || ''}`)
    ]
  });
}

function gradeTable(subject) {
  const widths = [820, 5152, 1519, 1430, 1659];
  const total = widths.reduce((a, b) => a + b, 0);
  const C = AlignmentType.CENTER;

  const headRow = new TableRow({
    tableHeader: true,
    children: ['Seq.', 'Names', 'Final Grade', 'Equivalent', 'Remarks']
      .map((t, i) => cell(para(t, { align: C, bold: true }), { width: widths[i] }))
  });

  const students = [...subject.students].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  const rows = students.map((s, i) => {
    const { final } = computeFinalGrade(subject, s.id);
    const fg = final === null ? '' : String(Math.round(final));
    const eq = gradeEquivalent(final, s.remarksOverride);
    const cells = [
      String(i + 1),
      s.name,
      fg,
      eq === null ? '' : eq.toFixed(2),
      gradeRemarks(final, s.remarksOverride)
    ];
    return new TableRow({
      children: cells.map((t, ci) =>
        cell(para(t, { align: ci === 1 ? AlignmentType.LEFT : C }), { width: widths[ci] })
      )
    });
  });

  const nothingRow = new TableRow({
    children: [cell(para('Nothing Follows', { align: C, bold: true }), { colSpan: 5, width: total })]
  });

  return new Table({
    columnWidths: widths,
    width: { size: total, type: WidthType.DXA },
    rows: [headRow, ...rows, nothingRow]
  });
}

function instructionsBlock() {
  return [
    para('Instructions:', { bold: true, spacing: { before: 200, after: 60 } }),
    ...INSTRUCTIONS.map((t, i) => new Paragraph({
      children: [run(`${i + 1}. ${t}`)],
      spacing: { after: 40 }
    }))
  ];
}

function signatureBlock(course) {
  const line = (a, b, opts = {}) => new TableRow({
    children: [
      cell(para(a, { bold: opts.bold }), { borders: BORDERLESS, width: 5290 }),
      cell(para(b, { bold: opts.bold }), { borders: BORDERLESS, width: 5290 })
    ]
  });
  return new Table({
    columnWidths: [5290, 5290],
    width: { size: 10580, type: WidthType.DXA },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [
      line('Prepared by:', 'Verified by:'),
      line(' ', ' '),
      line(' ', ' '),
      line((course.instructor || '').toUpperCase(), (course.programChair || '').toUpperCase(), { bold: true }),
      line('Instructor', 'Program Chair')
    ]
  });
}

/* ---------- assemble ---------- */

export async function buildGradeSheetBlob(subject, semester = { label: '', schoolYear: '' }) {
  const course = subject.course;

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }
      },
      headers: { default: new Header({ children: [letterhead(), para('')] }) },
      children: [
        courseInfo(course, semester),
        para(''),
        gradeTable(subject),
        para(''),
        ...instructionsBlock(),
        para(''),
        para(''),
        signatureBlock(course)
      ]
    }]
  });

  return Packer.toBlob(doc);
}
