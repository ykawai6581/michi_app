# Codex project instructions

## Environment

The Codex Cloud environment for this repository is already configured by the
environment setup script.

Python GIS dependencies from `requirements-preprocess.txt` are preinstalled,
including GeoPandas, Shapely, PyArrow, and Pyogrio.

Root npm dependencies and `tools/road-builder` npm dependencies are also
preinstalled.

Do NOT install, upgrade, downgrade, or repair dependencies during normal Codex
tasks.

Do NOT run dependency-installation commands such as:

- pip install
- python -m pip install
- npm install
- npm ci
- apt install
- apt-get install
- package-manager upgrade commands

unless the user explicitly asks to change the dependency environment.

If an expected dependency cannot be imported:

1. Stop that validation step immediately.
2. Report the missing dependency and exact import error.
3. Do NOT attempt to install, upgrade, downgrade, or repair it.
4. Continue only with validation steps that do not depend on the missing package,
   unless the missing dependency prevents meaningful validation entirely.

## General implementation approach

Prefer small, focused changes.

Do not redesign unrelated architecture while fixing a specific issue.

Preserve existing behavior unless the task explicitly asks to change it.

When working on matcher, manual-selection, or connectivity behavior, first
understand the existing invariants and tests before modifying implementation.

Do not weaken an existing correctness assertion merely to make a failing test or
workflow pass. If an assertion exposes a real implementation problem, fix the
implementation.

## Python GIS validation

For changes involving N13 matching, topology, road connectivity, source
geometry, manual N13 selection, or GIS code, run the smallest relevant
GeoPandas test first.

For manual-selection and connectivity work, prefer targeted tests from:

    scripts/preprocess/test_match_road.py

Example:

    python -m unittest \
      scripts.preprocess.test_match_road.StableIdentityAndManualSelectionTests

When the targeted tests pass, run the broader matcher suite when appropriate:

    python -m unittest scripts/preprocess/test_match_road.py

Also run Road UI Python tests when backend preview/cache/API behavior changes:

    PYTHONPATH=scripts/road-ui \
      python -m unittest scripts/road-ui/test_road_ui.py

Some full-suite tests may have pre-existing failures on main. Do not
automatically treat every unrelated pre-existing failure as caused by the
current task.

When a broader suite fails:

1. identify whether the failing test is related to the current change;
2. compare against the baseline behavior where practical;
3. report unrelated pre-existing failures separately;
4. do not modify unrelated matcher behavior just to make the full suite green.

## Road Builder validation

For Road Builder frontend changes, run:

    npm --prefix tools/road-builder test

Then, when appropriate:

    npm run build
    npm run lint
    git diff --check

For Python-only changes, do not spend time changing frontend code unless the task
requires it.

For frontend-only changes, do not alter matcher semantics unless the task
requires it.

## Testing strategy

Run targeted tests before broad test suites.

Do not repeatedly run a large test suite while debugging one known failing test.

A good sequence is:

1. Run the smallest relevant test.
2. Diagnose the failure.
3. Make one focused implementation change.
4. Rerun the targeted test.
5. Only after the targeted test passes, run broader validation.

Do not change tests merely to make them pass unless the existing test is
demonstrably incorrect or the requested behavior intentionally changes its
contract.

If changing a test is necessary, explain why the old expectation was wrong or
obsolete.

## Avoid repeated failing-test loops

Do not repeatedly rerun the same failing command without a new diagnosis.

Do not run the same failing command more than 3 total times during one task.

If the SAME targeted test still fails after TWO code-change attempts:

STOP.

Do not keep modifying implementation or tests speculatively.

Report:

1. the exact failing test or command;
2. the exact assertion or traceback;
3. the actual result;
4. the expected result;
5. the current diagnosis;
6. why the previous fixes did not work;
7. the relevant files and functions;
8. the smallest next experiment that should be tried.

Do not continue autonomously after reaching this point.

## N13 manual-review architecture

The intended Road Builder workflow is:

    Preview Match
    -> Manual Review
    -> Connect Selected
    -> Save & Build

Automatic matching proposes road identity.

Manual review determines which N13 source geometry the user accepts or rejects.

Connectivity reconstruction happens only after manual curation.

Save & Build must publish the exact current final connected preview rather than
rerunning the matcher.

Manual edits should not rerun the expensive automatic matcher.

Stable N13 source identities must not depend on dataframe row ordering.

Manual exclusions are hard constraints and must not be silently resurrected by
connectivity reconstruction.

Connectivity reconstruction must not discard geometry explicitly retained by
manual curation.

## Git and task scope

Keep commits focused on the requested task.

Do not bundle unrelated cleanup or refactors into the same commit.

Before finishing, summarize:

- files changed;
- behavior changed;
- targeted tests run and their results;
- broader tests run and their results;
- any known pre-existing failures or remaining limitations.

Do not create additional speculative fixes after the requested behavior is
working and validated.
