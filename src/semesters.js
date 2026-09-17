import {
  state, TERMS, createSemester, createSubject,
  getActiveSemester, semesterLabel, subjectsInSemester, schoolYears,
  reconcileState, scheduleSave
} from './state.js';
import { requestRender } from './bus.js';
import { escapeHtml, uid } from './utils.js';
import { confirmAction, formDialog } from './dialog.js';

export function initSemesters() {
  document.getElementById('schoolYearSelect').addEventListener('change', e => {
    const first = state.semesters.find(s => s.schoolYear === e.target.value);
    if (first) state.activeSemesterId = first.id;
    reconcileState();
    scheduleSave();
    requestRender();
  });

  document.getElementById('semesterSelect').addEventListener('change', e => {
    state.activeSemesterId = e.target.value;
    reconcileState();
    scheduleSave();
    requestRender();
  });

  document.getElementById('addSemesterBtn').addEventListener('click', addSemester);
  document.getElementById('editSemesterBtn').addEventListener('click', editSemester);
  document.getElementById('delSemesterBtn').addEventListener('click', deleteSemester);

  document.getElementById('addSchoolYearBtn').addEventListener('click', addSchoolYear);
  document.getElementById('editSchoolYearBtn').addEventListener('click', renameSchoolYear);
  document.getElementById('delSchoolYearBtn').addEventListener('click', deleteSchoolYear);
}

/** Deep-copy a subject's structure into a new semester, scores blanked. */
function cloneStructure(src, semesterId) {
  const s = createSubject(src.course, semesterId);
  s.students = src.students.map(st => ({ id: uid(), name: st.name }));
  for (const tk of TERMS) {
    const catMap = new Map();
    s.terms[tk].categories = src.terms[tk].categories.map(c => {
      const nc = { id: uid(), name: c.name, weight: c.weight };
      catMap.set(c.id, nc.id);
      return nc;
    });
    s.terms[tk].assignments = src.terms[tk].assignments.map(a => ({
      id: uid(), name: a.name, categoryId: catMap.get(a.categoryId), max: a.max, date: a.date || ''
    }));
  }
  return s; // scores stay {}
}

async function addSemester() {
  const others = state.semesters;
  const current = getActiveSemester();
  const fields = [
    { key: 'schoolYear', label: 'School Year', placeholder: 'e.g. SY 2026-2027',
      value: current ? current.schoolYear : '' },
    { key: 'label', label: 'Semester', placeholder: 'e.g. FIRST SEMESTER' }
  ];
  if (others.length) {
    fields.push({
      key: 'carry', label: 'Carry forward subjects from (optional)', type: 'select',
      options: [
        { value: '', label: '— none —' },
        ...others.map(s => ({ value: s.id, label: semesterLabel(s) }))
      ]
    });
  }

  const res = await formDialog({ title: 'Add semester', fields, confirmLabel: 'Add semester' });
  if (!res || (!res.schoolYear && !res.label)) return;

  const sem = createSemester({ schoolYear: res.schoolYear, label: res.label });
  state.semesters.push(sem);

  let copied = 0;
  if (res.carry) {
    for (const src of subjectsInSemester(res.carry)) {
      state.subjects.push(cloneStructure(src, sem.id));
      copied++;
    }
  }

  state.activeSemesterId = sem.id;
  reconcileState();
  scheduleSave(copied
    ? `Semester added — ${copied} subject${copied === 1 ? '' : 's'} carried over (scores blanked)`
    : 'Semester added');
  requestRender();
}

async function editSemester() {
  const sem = getActiveSemester();
  if (!sem) return;
  const res = await formDialog({
    title: 'Rename semester',
    fields: [
      { key: 'schoolYear', label: 'School Year', value: sem.schoolYear, placeholder: 'e.g. SY 2026-2027' },
      { key: 'label', label: 'Semester', value: sem.label, placeholder: 'e.g. FIRST SEMESTER' }
    ],
    confirmLabel: 'Save'
  });
  if (!res) return;
  sem.schoolYear = res.schoolYear;
  sem.label = res.label;
  reconcileState();
  scheduleSave('Semester updated');
  requestRender();
}

/* ---------- school year ---------- */

async function addSchoolYear() {
  const res = await formDialog({
    title: 'Add school year',
    fields: [
      { key: 'schoolYear', label: 'School Year', placeholder: 'e.g. SY 2026-2027' },
      { key: 'label', label: 'First semester', placeholder: 'e.g. FIRST SEMESTER' }
    ],
    confirmLabel: 'Add'
  });
  if (!res || (!res.schoolYear && !res.label)) return;

  const sem = createSemester({ schoolYear: res.schoolYear, label: res.label });
  state.semesters.push(sem);
  state.activeSemesterId = sem.id;
  reconcileState();
  scheduleSave('School year added');
  requestRender();
}

async function renameSchoolYear() {
  const active = getActiveSemester();
  if (!active) return;
  const oldSy = active.schoolYear;
  const res = await formDialog({
    title: 'Rename school year',
    message: `Applies to every semester in "${oldSy}".`,
    fields: [{ key: 'schoolYear', label: 'School Year', value: oldSy, placeholder: 'e.g. SY 2026-2027' }],
    confirmLabel: 'Save'
  });
  if (!res || !res.schoolYear || res.schoolYear === oldSy) return;
  for (const s of state.semesters) {
    if (s.schoolYear === oldSy) s.schoolYear = res.schoolYear;
  }
  scheduleSave('School year renamed');
  requestRender();
}

async function deleteSchoolYear() {
  const active = getActiveSemester();
  if (!active) return;
  const sy = active.schoolYear;
  const semIds = new Set(state.semesters.filter(s => s.schoolYear === sy).map(s => s.id));
  const subCount = state.subjects.filter(s => semIds.has(s.semesterId)).length;

  const ok = await confirmAction({
    title: 'Delete this school year?',
    message: `Delete school year "${sy}" — ${semIds.size} semester${semIds.size === 1 ? '' : 's'}${subCount ? ` and ${subCount} subject${subCount === 1 ? '' : 's'}` : ''}? This can't be undone.`,
    confirmLabel: 'Delete school year',
    cancelLabel: 'Keep it',
    tone: 'danger'
  });
  if (!ok) return;

  state.subjects = state.subjects.filter(s => !semIds.has(s.semesterId));
  state.semesters = state.semesters.filter(s => !semIds.has(s.id));
  state.activeSemesterId = state.semesters[0] ? state.semesters[0].id : null;
  reconcileState();
  scheduleSave('School year deleted');
  requestRender();
}

async function deleteSemester() {
  const sem = getActiveSemester();
  if (!sem) return;
  const subs = subjectsInSemester(sem.id);
  const ok = await confirmAction({
    title: 'Delete this semester?',
    message: `Delete "${semesterLabel(sem)}"${subs.length ? ` and its ${subs.length} subject${subs.length === 1 ? '' : 's'}` : ''}? This can't be undone.`,
    confirmLabel: 'Delete semester',
    cancelLabel: 'Keep it',
    tone: 'danger'
  });
  if (!ok) return;

  const gone = new Set(subs.map(s => s.id));
  state.subjects = state.subjects.filter(s => !gone.has(s.id));
  state.semesters = state.semesters.filter(s => s.id !== sem.id);
  state.activeSemesterId = state.semesters[0] ? state.semesters[0].id : null;
  reconcileState();
  scheduleSave('Semester deleted');
  requestRender();
}

export function renderSemesterSwitcher() {
  const syEl = document.getElementById('schoolYearSelect');
  const semEl = document.getElementById('semesterSelect');
  const actionBtns = ['editSemesterBtn', 'delSemesterBtn', 'editSchoolYearBtn', 'delSchoolYearBtn']
    .map(id => document.getElementById(id));

  if (!state.semesters.length) {
    syEl.innerHTML = '<option value="">No school years yet</option>';
    semEl.innerHTML = '<option value="">No semesters yet</option>';
    syEl.disabled = semEl.disabled = true;
    actionBtns.forEach(b => { b.disabled = true; });
    return;
  }
  syEl.disabled = semEl.disabled = false;
  actionBtns.forEach(b => { b.disabled = false; });

  const active = getActiveSemester();
  const years = schoolYears();
  const activeSy = active ? active.schoolYear : years[0];

  syEl.innerHTML = years
    .map(y => `<option value="${escapeHtml(y)}" ${y === activeSy ? 'selected' : ''}>${escapeHtml(y)}</option>`)
    .join('');

  semEl.innerHTML = state.semesters
    .filter(s => s.schoolYear === activeSy)
    .map(s => `<option value="${s.id}" ${s.id === state.activeSemesterId ? 'selected' : ''}>${escapeHtml(s.label || 'Untitled')}</option>`)
    .join('');
}
