# Progress / Backlog Trends: Analysis Scope refinement

Verified on 23 October 2026. Implementation only; nothing staged, committed or pushed.

## A. Previous behavior

Academic Period mixed semesters and study years in a flat selector. Scope was
represented by separate `semester` / `academic_year` parameters. The backend already
iterated students for year summaries, but trends extended beyond the selected
scope and incomplete year history could hide a proven unresolved required-course
failure. Course rows could also be suppressed merely because overall year
completion was unknown. The selector could show a newly selected semester while
old cards/headings remained visible until Apply Filters was pressed.

## B. New Analysis Scope

One selector, with HTML optgroups:

```
Analysis Scope
  Semesters
    Semester 1
    Semester 2
    ... recorded, supported semesters only
  Study Years
    First Year
    Second Year
    ... available study years only
```

The current MCA 2025 database offers Semester 1, Semester 2 and First Year.
Configured future Semester 3/4 courses alone do not create options. The existing
recorded-participation query supplies semester availability; existing batch-duration
configuration bounds supported semesters. Existing `academicYearGroups` supplies
the complete semester-pair mapping and year labels. A partially reached study year
is available for analysis, but missing evidence cannot certify completion. Second
Year becomes available when its semesters have recorded participation. No separate
year filter or hardcoded MCA-only mapping was introduced.

Preferred query format: `analysis_scope=semester:2` or `analysis_scope=year:1`.
Legacy `semester=2` / `academic_year=1` bookmarks remain accepted. Identical legacy
and preferred values are accepted; contradictory scopes, simultaneous legacy
semester/year, arrays, invalid formats/ranges, unsupported scope_type/value pairs,
invalid result modes and scopes unavailable for the selected batch are rejected
server-side with HTTP 400. Successful browser loads canonicalize the URL. The
latest recorded semester remains the default.

## C. Semester behavior

Cards, status chart, course table, attention rows and clearance metrics use only
the selected semester. Population remains the existing non-deleted batch student
population, including students whose history is insufficient. Existing semester
classification and required-course/attempt rules remain unchanged.

Changing scope loads it immediately; Apply Filters remains available. Pending
loads clear old cards/headings/charts and response version checks prevent stale
responses replacing a newer selection. The backend-returned scope controls the
selected option, completion heading, chart title and accessible label together.

## D. Study-Year behavior

A year is evaluated once per student across its complete semester pair, never by
adding semester student counts. Both semesters require verified completion for a
cleared classification. A verified earlier failure cleared by a valid later retake
can establish Cleared With Backlog only when the entire year is completed.

On this page, a canonical required-course outcome with `cleared === false` anywhere
in a study year makes the student Currently Uncleared, even if another semester
is missing. Otherwise insufficient evidence remains Unknown. This is an explicit
page-specific attention precedence; shared outcome/Reports policies were not
changed. No missing evidence becomes a pass and no GPA is recalculated.

## E. Graph behavior

The status graph title/ARIA label is dynamic, for example Semester 2 Completion
Status or First Year Completion Status. Its four values exactly match the scope
summary, including Unknown / Insufficient Evidence.

Semester Completion Trends remains separate semester bars, preserving historical
progression through the selected scope's last semester. Semester 1 shows recorded
Sem 1 participation; Semester 2/First Year show recorded Sem 1 and Sem 2. Second
Year may show recorded earlier semesters through Sem 4. Unrecorded semesters have
no fabricated zero bars. Each bar includes only its own recorded participants,
not all batch students and not a year aggregate.

## F. Backlog course table

Semester scope includes that semester's courses only. Year scope includes both
semesters and retains the Semester column. Stable course IDs distinguish rows;
equal displayed codes in different semesters are not merged. Verified per-course
backlog evidence remains visible even when a different semester leaves the year
completion unknown. No course offering or academic record is rewritten.

## G. Clearance rate

Numerator: students with verified first-sitting failures who completed the selected
scope through valid retake clearance. Denominator: students with verified
first-sitting failures and known scope completion status. Each student contributes
at most once, even with failures in both semesters. Unknown and no-backlog students
are excluded. The rate is null (displayed as a dash) when the denominator is zero.
Course-table rates remain per-course student counts and are not summed into the
scope-level student rate.

## H. Unknown / insufficient evidence and attention

Missing/unverified roster, missing original history, unsupported chronology or
unresolved evidence cannot establish clearance. Missing another semester leaves
otherwise completed students Unknown. Proven unresolved year work remains
Currently Uncleared as described above. Attention rows contain each student once;
year rows identify failed work with semester-specific details, such as
`Semester 1: C1; Semester 2: C2`. The existing 20-row preview cap and accurate total
are retained. Attention's legacy JSON field `period` remains for compatibility,
but the visible column is Analysis Scope.

## I. Exact files changed for this request

1. `services/progressAnalyticsService.js`
2. `public/js/analytics/progress.js`
3. `views/analytics/progress.ejs`
4. `tests/analytics-progress.test.js`
5. `tests/reports-browser.js` (updated scope control/value references; not executed as a live browser suite)
6. `tests/progress-analysis-scope.test.js` (new)
7. `tests/progress-scope-client.test.js` (new)
8. `docs/progress-analysis-scope-report.md` (this report)

Existing unrelated working-tree changes, including the ExamSession refactor and
four intentionally excluded historical reports, were preserved. No schema,
migration, ExamSession rule, shared outcome service, Reports calculation or
historical academic data was modified for this request.

## J. Executed tests

| Suite | Passed | Failed | Skipped | Exit |
|---|---:|---:|---:|---:|
| Progress scope/client/progress/year tests | 44 | 0 | 2 | 0 |
| Broader focused integrity/Analytics regression | 149 | 0 | 4 | 0 |
| Read-only DB integration suite | 85 | 0 | 0 | 0 |
| Complete discovered tests/ + test/ suite | 660 | 4 | 12 | 1 |

Scope fixtures cover both study years, first passes, later retake clearances,
uncleared work, partial history, failures in both semesters, stable course IDs,
per-student clearance rates, distinct trend bars, no future options, configured
batch bounds, Original/Effective selection, legacy/conflicting inputs, empty
participation and population chunks of 500 + 1. Client tests execute the real
browser script with a DOM fixture and check grouped options, canonical requests,
headings, chart values/ARIA, trends and attention scope text.

The broader focused run covers Progress, Analytics overview/student search,
backlog/exam types, structured periods, ExamSession compatibility, session identity,
revaluation integrity, conditional verification, required-course roster and academic
outcomes. The read-only DB run covers Reports, academic outcomes, Analytics
progress/failure/student search, report student search and student directory. Its
revaluation-overlay probe uses SELECT-only CTE fixtures; no real history is edited.

All four complete-suite failures are the known pre-existing demo-seed failures:
missing seed_all.js; 92 versus 102 planned results; refusing demo percentages for
protected real students; 8 versus 9 ledger scenarios. No new regression failure
remains. Optional real/demo DB tests remain skipped unless explicitly enabled.

Syntax checks passed for the changed JavaScript modules/tests and the updated
browser harness (exit 0). `git diff --check` passed (exit 0); existing CRLF conversion
advisories do not indicate whitespace errors. No authenticated visual browser tour
is claimed. The local app was restarted to load the updated service.

## K. Live development-data check (read only)

MCA 2025, batch ID 1. Values generated by `getProgress` using the current database:

| Basis | Scope | Total | Without backlog | With backlog | Uncleared | Unknown | Backlog clearance |
|---|---|---:|---:|---:|---:|---:|---:|
| Original | Semester 1 | 88 | 9 | 0 | 3 | 76 | 0% |
| Original | Semester 2 | 88 | 5 | 0 | 2 | 81 | 0% |
| Original | First Year | 88 | 5 | 0 | 3 | 80 | 0% |
| Effective | Semester 1 | 88 | 10 | 0 | 2 | 76 | 0% |
| Effective | Semester 2 | 88 | 5 | 0 | 2 | 81 | 0% |
| Effective | First Year | 88 | 5 | 0 | 2 | 81 | 0% |

Every scope totals 88, not 176. Semester 1 course output contains only semester 1;
Semester 2 only semester 2; First Year contains both. Trend output is [1] for
Semester 1 and [1, 2] for Semester 2/First Year. First Year attention includes
3 unique students in Original and 2 in Effective. No real retake was manufactured
to demonstrate a nonzero clearance rate; those cases are isolated fixtures.

Before/after checksums and counts matched exactly (verification exit 0):

| Table | Before/after count | SHA-256 |
|---|---:|---|
| students | 88 | `0c1b18b081bf59c84c72f4097de04dae47343a36278ca313c1380313b4734ae9` |
| results | 20 | `a487468f714f97130b9bf6f037a0598b48685b75ca253e4eaef3a6fe76872bfa` |
| subject_results | 129 | `f2a3295a02c5397a15b340d398d3f09465c6af61c25fda22512e9cdc145bdcff` |
| revaluation_results | 1 | `477d607de2ce99c8062cd99caf0b0f7b42339b378abe8e3116f78e8bbac0eb80` |

## L. Git status

Branch `feature/login`, still ahead of `origin/feature/login` by 3 commits.
Nothing staged. Full working-tree status/stat include the substantial pre-existing
ExamSession and earlier follow-up work; the eight files in section I are this
request's exact scope. The four excluded historical reports remain untracked.
Ran git status, git diff --stat and git diff --check. No staging, commit, amend,
push, reset, restore, clean or discard performed.
