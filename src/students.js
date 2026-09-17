import { getActiveSubject, scheduleSave } from './state.js';
import { requestRender } from './bus.js';
import { uid, escapeHtml } from './utils.js';
import { confirmAction } from './dialog.js';
import { isDropped } from './grading.js';

let search = '';
let editingId = null;

export function initStudents() {
  document.getElementById('addStudentBtn').addEventListener('click', addStudent);
  document.getElementById('studentNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addStudent();
  });

  document.getElementById('studentSearchSetup').addEventListener('input', e => {
    search = e.target.value.toLowerCase();
    renderStudents();
  });

  const list = document.getElementById('studentList');
  list.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    if (action === 'edit') startEdit(id);
    if (action === 'save') commitEdit();
    if (action === 'cancel') cancelEdit();
    if (action === 'remove') removeStudent(id);
  });
  list.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-field]')) setField(el.dataset.id, el.dataset.field, el.value.trim());
  });
  // Live strikethrough as you type "Dropped" — a direct style tweak, not a
  // re-render, so it doesn't fight the browser mid-keystroke.
  list.addEventListener('input', e => {
    const el = e.target;
    if (!el.matches('[data-field="remarksOverride"]')) return;
    const nameCell = el.closest('tr').querySelector('td');
    nameCell.style.textDecoration = isDropped(el.value) ? 'line-through' : '';
    nameCell.style.color = isDropped(el.value) ? 'var(--ink-muted)' : '';
  });
  list.addEventListener('keydown', e => {
    if (!editingId) return;
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
}

function addStudent() {
  const active = getActiveSubject();
  const input = document.getElementById('studentNameInput');
  const name = input.value.trim();
  if (!name || !active) return;
  active.students.push({ id: uid(), name });
  input.value = '';
  scheduleSave('Student added');
  requestRender();
}

function startEdit(id) {
  editingId = id;
  requestRender();
  const field = document.querySelector('#studentList [data-edit-field="name"]');
  if (field) { field.focus(); field.select(); }
}

function cancelEdit() {
  editingId = null;
  requestRender();
}

function commitEdit() {
  const active = getActiveSubject();
  const nameField = document.querySelector('#studentList [data-edit-field="name"]');
  if (!active || !nameField) return;
  const name = nameField.value.trim();
  if (!name) { nameField.focus(); return; }
  const student = active.students.find(s => s.id === editingId);
  if (student) student.name = name;
  editingId = null;
  scheduleSave('Student updated');
  requestRender();
}

/** Remarks/notes: edited inline, no Edit-click needed. Saved on blur (not
 * re-rendered) so tabbing away isn't interrupted by the row being redrawn
 * out from under the browser's focus. */
function setField(id, field, value) {
  const active = getActiveSubject();
  if (!active) return;
  const student = active.students.find(s => s.id === id);
  if (!student) return;
  student[field] = value;
  scheduleSave('Student updated');
}

async function removeStudent(id) {
  const active = getActiveSubject();
  if (!active) return;
  const student = active.students.find(s => s.id === id);
  if (!student) return;

  const scoreCount = Object.keys(active.scores).filter(k => k.startsWith(id + '_')).length;
  const tail = scoreCount ? ` and ${scoreCount} score${scoreCount === 1 ? '' : 's'}` : '';
  const ok = await confirmAction({
    title: 'Delete this student?',
    message: `Delete "${student.name}"${tail}? This can't be undone.`,
    confirmLabel: 'Delete student',
    cancelLabel: 'Keep it',
    tone: 'danger'
  });
  if (!ok) return;

  active.students = active.students.filter(s => s.id !== id);
  // Drop this student's scores so they don't linger as orphans.
  Object.keys(active.scores).forEach(k => {
    if (k.startsWith(id + '_')) delete active.scores[k];
  });
  scheduleSave('Student deleted');
  requestRender();
}

export function renderStudents() {
  const active = getActiveSubject();
  const tbody = document.getElementById('studentList');
  const empty = document.getElementById('studentEmpty');
  tbody.innerHTML = '';

  if (!active) {
    empty.style.display = 'block';
    empty.textContent = 'Add a subject first.';
    document.getElementById('studentCountTag').textContent = '';
    return;
  }

  const filtered = active.students.filter(s => s.name.toLowerCase().includes(search));
  tbody.innerHTML = filtered.map(s => {
    const remarksCell = `<td><input class="edit-input" type="text" value="${escapeHtml(s.remarksOverride || '')}"
      placeholder="Notes or Remarks — e.g. Dropped" data-field="remarksOverride" data-id="${s.id}"></td>`;

    if (s.id === editingId) {
      return `<tr>
        <td><input class="edit-input" type="text" value="${escapeHtml(s.name)}" data-edit-field="name"></td>
        ${remarksCell}
        <td style="text-align:right;white-space:nowrap;">
          <button class="btn-icon save" data-action="save">✓ Save</button>
          <button class="btn-icon" data-action="cancel">Cancel</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td${isDropped(s.remarksOverride) ? ' style="text-decoration:line-through;color:var(--ink-muted);"' : ''}>${escapeHtml(s.name)}</td>
      ${remarksCell}
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn-icon edit" data-action="edit" data-id="${s.id}">✎ Edit</button>
        <button class="btn-icon danger" data-action="remove" data-id="${s.id}">✕ Delete</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('studentCountTag').textContent = `(${active.students.length})`;
  empty.style.display = filtered.length ? 'none' : 'block';
  empty.textContent = active.students.length
    ? 'No students match your search.'
    : 'No students yet — add your first one above.';
}
