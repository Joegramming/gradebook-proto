# Gradebook

A multi-subject gradebook. Subjects live under a **semester** (school year +
label); the sidebar switches School Year → Semester → Subject, so past semesters
stay browsable. Each subject holds its course details, its students, and three
terms (Prelims / Midterms / Finals) — each term with its own weighted grade
categories and assignments. The Reports page turns those into per-term grades and
an equal-thirds final you can print.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
```

| Script            | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Dev server with hot reload                    |
| `npm run build`   | Production build into `dist/`                 |
| `npm run preview` | Serve the built `dist/` to check it locally   |
| `npm test`        | Run the unit tests once (Vitest)             |
| `npm run test:watch` | Re-run tests on change                     |
| `npm run app:dev` | Run the desktop app (Tauri) against the dev server |
| `npm run app:build` | Build the Windows installer (`src-tauri/target/release/bundle/`) |
| `npm run deploy`  | Build and publish the browser version to the `gh-pages` branch |
| `npm run kill-port` | Kill whatever holds port 5173 (Windows) — for when a stray/crashed dev server blocks a restart. `-- -Port <n>` for another port |

## Preview on GitHub Pages

`npm run deploy` builds with `--mode pages` (which shows a "data is saved only
in this browser" note) and pushes `dist/` to the `gh-pages` branch via the
`gh-pages` package. The browser version uses the localStorage adapter
automatically — no server, data lives in each visitor's browser.

One-time repo setup: **Settings → Pages → Source → "Deploy from a branch" →
`gh-pages` / `/ (root)`**. The site then serves at
<https://joegramming.github.io/grading-system-proto/> (relative `base` in
`vite.config.js` makes the repo sub-path work).

## Layout

```
index.html            markup only — every id here is what the JS binds to
src/
  main.js             boot: wire modules, load data, first render
  render.js           renderAll() — redraws every view
  bus.js              requestRender(), so modules don't import render.js
  nav.js              the Setup / Grades / Reports page switch
  dialog.js           in-app modal confirm() / prompt() / formDialog() replacements
  state.js            the state object + load/save + pre-semester migration
  state.test.js       Vitest unit tests for the migration / reconcile
  utils.js            uid, escapeHtml, showToast
  grading.js          pure grade math (no DOM) — the part worth unit testing
  grading.test.js     Vitest unit tests for grading.js
  semesters.js        School Year / Semester switchers + add (with carry-forward) / rename / delete
  subjects.js         subject switcher (filtered to the active semester) + course-details fields
  terms.js            the Prelims / Midterms / Finals switch
  students.js         student list + search (name + sex)
  categories.js       per-term categories, weights, weight bar
  assignments.js      per-term assignments + the category dropdown
  grades.js           the score matrix (per term)
  grades.test.js      Vitest unit tests for parseScoreInput
  reports.js          final grades, letter grades, print
  csv.js              CSV import parsing (no DOM) — unit tested
  csv.test.js         Vitest unit tests for csv.js
  xlsx.js             class-record .xlsx — build (exceljs, live formulas) + parse/re-import — unit tested
  xlsx.test.js        Vitest unit tests for xlsx.js
  gradesheet.js       registrar grade-sheet .docx builder (docx lib) — unit tested
  gradesheet.test.js  Vitest unit tests for gradesheet.js
  asc-logo.js         base64 letterhead logo for the grade sheet
  portio.js           wires csv.js / xlsx.js / gradesheet.js to the Import/Export buttons
  docs/               client reference templates (gitignored — kept locally only):
                        sample-sheet.xlsx — the .xlsx class-record export follows it
                        sample-doc.doc    — the .docx grade-sheet export follows it
  api/
    index.js          auto-picks the adapter — the only door to storage
    local.js          localStorage — used in a plain browser
    tauri.js          JSON file in the OS app-data folder — used in the desktop app
src-tauri/            the Tauri (Rust) desktop shell — see "Desktop app" below
scripts/
  kill-port.ps1       `npm run kill-port` — free port 5173 (Windows)
legacy/
  grading-system.html the original single-file version, kept for reference
```

### How a change flows

A module mutates `state`, calls `scheduleSave()` (debounced 400ms) and
`requestRender()`. `render.js` redraws everything — cheap at classroom scale,
and it means no module needs to know which other views its change affects.

Event handlers are **delegated**: rows carry `data-action` / `data-id` and each
module puts one listener on the container. Inline `onclick=` will not work here
— handlers live in module scope, which the global HTML scope can't reach.

## Data

`src/api/` is the only place that touches storage. Every adapter implements the
same two methods:

```js
load()      // -> Promise<state | null>   null = nothing saved yet
save(state) // -> Promise<void>           throws on failure
```

The adapter is chosen automatically, no config:

| Where it runs            | Adapter    | Storage                                   |
| ------------------------ | ---------- | ----------------------------------------- |
| Tauri desktop app        | `tauri.js` | `gradebook.json` in the OS app-data folder |
| Plain browser (dev/build)| `local.js` | localStorage (this browser only)          |

`index.js` sniffs for the Tauri runtime (`window.__TAURI_INTERNALS__`) and, when
present, dynamically imports `tauri.js`; a browser build never pulls it in. No UI
module knows the difference — the `load()` / `save()` seam is the whole contract.

### State shape

```js
{
  activeSemesterId: "sm01",
  activeSubjectId: "ab12cd34",
  activeTerm: "prelims",                            // prelims | midterms | finals
  semesters: [{ id, schoolYear, label }],           // e.g. "SY 2025-2026" / "Second Semester"
  subjects: [{
    id,
    semesterId,                                     // which semester it belongs to
    // plain strings; courseYear / instructor / programChair feed the Word grade sheet
    course: { code, name, schedule, set, courseYear, instructor, programChair },
    students: [{ id, name, sex }],                                  // sex: '' | 'M' | 'F'
    terms: {
      prelims:  { categories: [{ id, name, weight }], assignments: [{ id, name, categoryId, max, date }] },
      midterms: { /* same shape */ },
      finals:   { /* same shape */ }
    },
    scores: { "<studentId>_<assignmentId>": { score, excused } }   // assignment ids are unique across terms
  }]
}
```

Pre-semester saves migrate on load (`migrateToSemesters` in `state.js`): one
semester per distinct `(schoolYear, semester)` pair found on the old subjects,
blanks fold into an "Unsorted" semester, and those two fields move off
`subject.course`.

## Grading rules

Follows the client's class-record scheme (see `docs/sample-sheet.xlsx`).

- Each term (Prelims / Midterms / Finals) has its own categories, weights, and
  assignments.
- **Category %** (transmuted): `Σ(score) * 50 / Σ(max) + 50` over the student's
  graded, non-excused assignments in that category. 50 is the floor (a straight
  zero → 50, full marks → 100). Null until something is graded.
- **Period grade** = `Σ( category% × weight/100 )`. **No re-normalisation** — a
  category with nothing graded contributes nothing, so the grade climbs as
  categories fill in. (Set weights to total 100%.) Null until one category is
  graded.
- **Final grade** = `(Prelims + Midterms + Finals) / 3`, shown once all three
  periods have a grade.
- Blank (or unparseable) score = not graded yet, and is excluded from both
  `Σ(score)` and `Σ(max)`. "exc." excludes an assignment entirely.
- Scores above an assignment's max are kept (extra credit) but the box turns
  red so a typo stands out.
- Letters (Reports page): A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, else F.
- **Equivalent** (1.00–5.00) and **Remarks** (Passed / Failed / Incomplete) for
  the registrar grade sheet come from the rounded final grade —
  `gradeEquivalent()` / `gradeRemarks()` in `grading.js`. ⚠ The equivalent band
  table there is **provisional** (extrapolated from `docs/sample-doc.doc`);
  swap in the school's official conversion table before relying on it.

## Import / export

The Setup page has an **Import & export** card. The **Import…** button accepts
`.csv` or `.xlsx` and branches on the extension.

**Import a `.csv`** (`csv.js`) — one of two shapes, into the *active subject +
current term*:

- *Roster* — a single column of names (a `Student` / `Name` header row is
  optional). Each name becomes a student on the subject.
- *Grade matrix* — first row is `Student` followed by the current term's
  assignment names; each cell is a score, blank (leave as-is), or `EXC`.

Students are matched by name, case-insensitively, and created when missing.
Assignment columns with no name match in that term are reported and skipped —
CSV import never creates categories or assignments. Nothing is written until you
confirm the summary dialog.

**Import a `.xlsx` class record** (`xlsx.js` → `parseClassRecord`) — rebuilds
**one new subject per worksheet** that looks like a class record; nothing is
written until you confirm a summary dialog listing every subject it found
(`portio.js`). Two ways a sheet can match:

- **Strict** — a file this app's *old* (pre-legacy-format) exporter wrote,
  optionally edited in Excel: fixed header rows, course block, one student per
  row. Kept only so files exported before the current format shipped still
  re-import losslessly; the current exporter no longer produces this layout.
- **Legacy** — everything else, *including this app's current export* — a
  hand-built-looking school grade sheet with no fixed layout to rely on, read
  straight off its live grading formulas instead: the transmuted-%
  formula (`<total>*50/$<col>$<row>+50`), the weighted-score formula
  (`<pct>*$<col>$<row>`), and a final-grade average (`(a+b+c)/3`, or a fallback
  sum of known weighted columns) work out categories, items, and term grouping;
  student rows are read straight off the name column regardless of which rows
  still carry live formulas (real sheets often only keep formulas on the first
  row or two, the rest pasted values). This is a best-effort reconstruction —
  every result carries a warning to spot-check scores after importing, plus
  any grade component the term-grouping guess couldn't place (filed under
  Prelims). A blank template, or one with formulas stripped to typed-in
  numbers, can't be read this way — there's no structure left to detect.

Either way: the semester-label cell becomes a `semesterHint`, and `portio.js`
finds or creates the matching semester and files each new subject under it.
Formula columns are always ignored on import (the app recomputes). The
**"excused" flag is not restored** — excused cells export blank and re-import
as "not graded yet".

**Export class record (.xlsx)** — `xlsx.js` via `exceljs`, lazy-loaded. The
layout deliberately mirrors the client's own hand-built template
(`docs/sample-sheet.xlsx`) rather than a self-documenting one, so an exported
file looks like a sheet she could have built herself: `A1:A6` course block
(code / name / semester label / school year / schedule / set — no course
year, instructor, or program chair, since her sheet has no room for them),
then per period a category-name row, an assignment-label row (an item's date
if it has one, else its name — the two share one cell), and a max-points +
weight row; students from the row after that, name in column C. Per category:
`raw… → Total (skipped for a single-item category — the raw cell doubles as
the total) → % → Weighted`, then a period-grade column (skipped for a period
with nothing graded), then a Final Grade column once all three periods have
one. Every computed cell is a **live Excel formula**, matching hers: the `%`
is a plain division against the category's fixed max, **not re-normalised**
for missing scores — an only-partly-graded category understates % in the live
formula until every item is filled in (the app's own displayed grades are
unaffected; only the spreadsheet's own formula preview behaves this way, same
as a real hand-built sheet). Categories with no assignments are skipped.
Matching her layout costs the fields it has no room for: course year,
instructor, program chair, and a Letter column don't get written, so a
plain export → re-import round trip loses them (fill them back in on the
subject afterward) — everything else round-trips through the legacy reader.

**Export grade sheet (.docx)** — `gradesheet.js` via the `docx` lib,
lazy-loaded. Follows `docs/sample-doc.doc`: letterhead (logo + institution +
document-control box + "GRADE SHEET") in the page header; course-info block;
table `Seq. | Names | Sex | Final Grade | Equivalent | Remarks` (students sorted
by name) then a centred "Nothing Follows" row; the fixed 6-item instructions
list; a "Prepared by" (instructor) / "Verified by" (program chair) signature
block. Final Grade / Equivalent / Remarks come from `grading.js`.

## Desktop app

The shippable form is a Windows desktop app built with [Tauri](https://tauri.app)
(`src-tauri/`). Each teacher installs their own copy; the gradebook is one JSON
file, `gradebook.json`, under `%APPDATA%\com.gradebook.desktop\`. There is no
server, no account, and no sync — to move a whole subject between machines,
export its `.xlsx` class record and re-import it on the other side.

The web build (`npm run dev`, `npm run build`) still works unchanged and uses
localStorage; `src/api/index.js` picks the Tauri file adapter only when it sees
the Tauri runtime.

### Building it

One-time toolchain setup on the build machine (Windows):

1. **Rust** — install via <https://rustup.rs> (`rustup-init.exe`), then restart the shell.
2. **MSVC build tools** — "Desktop development with C++" workload from the
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
3. **WebView2** — already present on Windows 10/11; the installer bundles it as a fallback.

Then:

```bash
npm install
npm run app:build      # -> src-tauri/target/release/bundle/nsis/Gradebook_0.1.0_x64-setup.exe
```

`npm run app:dev` runs it live against the Vite dev server for development.

### Icon

`app-icon.png` (repo root, 1024×1024) is the source. Regenerate every size with:

```bash
npx tauri icon app-icon.png
```

Replace `app-icon.png` with real artwork and re-run to rebrand.
<br>
<br>
---

<sub>Originally developed by Augnina Reburiano.<br>
Transferred to Johann Liwag for further development.</sub>

---