# Testing

Start with the setup commands in [CONTRIBUTING.md](CONTRIBUTING.md).

## Automated coverage

New regression tests cover casting costs and failure policies, FP/ER/tally allocation, reference repair, profile import/export, grimoire search, effect selection, damage/recovery parsing, ownership, queued and idempotent resource spending, healing limits, and safe undo. Foundry actors and messages are mocked; the full GGA roll pipeline is not executed.

The suite exercises these behaviours but does not claim complete coverage or reproduce a connected Foundry world. All automated cases should run; the standard test command treats skipped Node tests as a failure. Test output is saved under `test-output/`.

## Source fixtures

No external source download is needed. Setup confirms that the suite uses its local fixtures or mocks.

## Live check

Open a saved casting profile and the Grimoire. Cast a normal spell and a healing/recovery effect, check resource spending, apply recovery once, and try GM undo. Check your usual roll visibility.

Use your normal Foundry/GGA versions and module combination, and refresh connected clients after updating. Record unexpected notifications, visibility changes, or changed resource totals, together with the module versions and steps to reproduce them.

## Package verification

The build checks module/package versions, install URLs, declared assets, local imports, the allowed archive file list, and every archived file's bytes. The release ZIP contains only runtime files, the licence, and user documentation.

## RPM Designer and magic resources

The suite covers published RPM calculations (pp. 17–19, 39), range/duration/weight boundaries, damage enhancements, full construction export/import, Path selection, and legacy profile migration. Threshold tests cover the cap, +0 overage, full-five-point modifiers, zero-cost casts, separate tallies, exact table lookup, visibility, tracker ownership/creation, and the Will gate at 29+.

Live checks: create an RPM ritual from the Grimoire, save/reopen it, create and select a magic pool and a threshold tracker, cast below/at/above the cap, and cast a zero-cost spell while already over. Confirm the shared and private roll modes, and resolve a cast with a selected world calamity table.

## Active effects and healing history

Tests cover schema-3 migration; expiry and rewind; zero-cost and paid maintenance; duplicate/concurrent payment requests; FP/resource splits and insufficient funds; cancellation and lapse; threshold checks; blind-card activation; bound healing recipients; per-caster/per-patient/per-spell history, failed attempts, daily boundaries, and interrupted-roll review. Workflow tests execute the real casting and mutation code with only the native GGA roll boundary replaced. DOM tests exercise the duration controls and an actual maintenance button. Summary API tests cover cast/received roles and synthetic actor identity.

Live checks: create a timed Light profile; start its effect; advance game time to maintenance; maintain and let expire; repeat with a threshold tally. Target one patient for Minor Healing twice, then Major Healing, and confirm the preview penalties. In GM Control Sheet, check cast and received badges, click through to the caster, and compare the timer after a time advance. Confirm private/blind behaviour with a connected player.
