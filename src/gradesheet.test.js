import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { buildGradeSheetBlob } from './gradesheet.js';

/** Pull one entry out of a zip buffer and inflate it (docx uses deflate). */
function zipEntry(buf, name) {
  const target = Buffer.from(name, 'latin1');
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) break; // local file header
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const entryName = buf.slice(i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    if (entryName.equals(target)) {
      return method === 0 ? data : inflateRawSync(data);
    }
    i = dataStart + compSize;
  }
  return null;
}

const semester = () => ({ label: '2nd Sem', schoolYear: '2025-2026' });

function subject() {
  return {
    id: 'sub1',
    course: {
      code: 'ITP 120', name: 'Systems Analysis and Design', schedule: '', set: '',
      courseYear: 'BSIT II-B', instructor: 'Helen S. Duriguez', programChair: 'Engr. Elias D. Edan Jr.'
    },
    students: [
      { id: 's1', name: 'ZAMORA, RICO' },
      { id: 's2', name: 'ABAD, MARIA' },
      { id: 's3', name: 'CRUZ, JOSE', remarksOverride: 'Dropped' }
    ],
    terms: {
      prelims: { categories: [{ id: 'c', name: 'Q', weight: 100 }], assignments: [{ id: 'p', name: 'Q1', categoryId: 'c', max: 100 }] },
      midterms: { categories: [{ id: 'c', name: 'Q', weight: 100 }], assignments: [{ id: 'm', name: 'Q1', categoryId: 'c', max: 100 }] },
      finals: { categories: [{ id: 'c', name: 'Q', weight: 100 }], assignments: [{ id: 'f', name: 'Q1', categoryId: 'c', max: 100 }] }
    },
    scores: {
      s1_p: { score: 80, excused: false }, s1_m: { score: 80, excused: false }, s1_f: { score: 80, excused: false },
      // s2 has no scores -> Incomplete
      s3_p: { score: 95, excused: false }, s3_m: { score: 95, excused: false }, s3_f: { score: 95, excused: false }
      // s3 scored 95 but has a "Dropped" remarks override -> Dropped, regardless of score
    }
  };
}

describe('buildGradeSheetBlob', () => {
  it('produces a non-empty .docx (zip) blob', async () => {
    const blob = await buildGradeSheetBlob(subject(), semester());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(2000);
    // .docx is a zip -> starts with "PK\x03\x04"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('has a header with the letterhead + logo, and a body with the table', async () => {
    const blob = await buildGradeSheetBlob(subject(), semester());
    const buf = Buffer.from(await blob.arrayBuffer());
    const names = buf.toString('latin1');

    expect(names).toContain('word/document.xml');
    expect(names).toMatch(/word\/header\d\.xml/);
    expect(names).toMatch(/word\/media\/\S+\.(jpe?g|png)/);

    const body = zipEntry(buf, 'word/document.xml').toString('utf8');
    expect(body).toContain('Nothing Follows');
    expect(body).toContain('Course Code: ITP 120');
    expect(body).toContain('Course and Year: BSIT II-B');
    expect(body).toContain('Semester: 2nd Sem');
    expect(body).toContain('School Year: 2025-2026');
    // students sorted by name -> ABAD before ZAMORA, seq 1 / 2
    expect(body.indexOf('ABAD, MARIA')).toBeLessThan(body.indexOf('ZAMORA, RICO'));
    // s1 scored 80 in all three terms -> final 80 -> Passed; s2 -> Incomplete;
    // s3 scored 95 but is dropped -> Dropped/0.00 regardless of the score
    expect(body).toContain('Incomplete');
    expect(body).toContain('Passed');
    expect(body).toContain('Dropped');
    expect(body).toContain('0.00');
    expect(body).toContain('HELEN S. DURIGUEZ');
    expect(body).toContain('Instructions:');

    const hdrName = names.match(/word\/(header\d\.xml)/)[1];
    const hdr = zipEntry(buf, 'word/' + hdrName).toString('utf8');
    expect(hdr).toContain('APAYAO STATE COLLEGE');
    expect(hdr).toContain('ASC-HED-IQF-13');
    expect(hdr).toContain('GRADE SHEET');
  });
});
