---
name: pack-overlay
description: >-
  Edit or seed first-class pack overlays under scripts/pack-overlays (tavan,
  medu-camp, …) and related seed/scaffold scripts. Use when the user asks to
  change pack flows, cases, k6/api scripts, or pack contracts.
---

# Pack overlay

## Scope

- Content: `scripts/pack-overlays/<pack>/`
- Seeders: `scripts/seed-*-pack.cjs`, `scripts/wire-*.cjs`, `scripts/lib/cde-pack-scaffold.cjs`
- Contracts: `tests/packs/*.test.cjs`

Packs are **first-class** — edit when the user asks about that pack.

## Steps

1. Identify pack id and whether change is overlay files, scaffold, seeder, or platform wiring.
2. Preserve existing folder conventions (flows/, cases/, scripts/, data/).
3. Update `tests/packs` contracts when structure/IDs change.
4. Prefer offline verification: `node --test tests/packs/*.test.cjs` then broader `npm test` if shared scaffold moved.
5. Run seed scripts only against local DB when the user wants seed applied (`npm run seed:tavan`, `seed:medu-camp`, `seed:pack`).

## IS tree

If the pack also materializes under external IS:

- Write only under `IS_TEST_REL` / prefer `IS_DOC_REL` (`test/doc`).
- Never touch IS `services/`.

## Coordinate

- Approach/API wiring → `source-approach-engineer`
- Runner tool execution → `run-pipeline-engineer`
- Gates → `platform-verify` skill
