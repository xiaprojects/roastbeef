# Glideslope reception: announced, not built

## Problem
RB-01 2.4.1 is announced with the ILS localizer as an experimental, supplemental feature
of the VOR plate, and the glideslope as the next step. Nothing of the glideslope exists in
code yet, in this repository or in `rb-vor`.

What there is today:

| Piece | State | Where |
|---|---|---|
| Localizer reception | Built, RB-VOR-IF v2.3, measured on synthetic signals only; no real localizer decoded yet | `../rb-vor` commit 2cb8d0f, `docs/loc-sweep.md`, CHANGELOG "ILS localizer, phase A" |
| Localizer on the plate | Built: LOC mode, deviation bar only at `locstatus` 4 and 5, "LOC SUPPLEMENTAL / NOT APPROACH GUIDANCE" | `web/RB-01/addons/vor.html`, `addons/js/vor.js` (commit 1fc41123, #168) |
| Glideslope reception | **Not built.** A plan only: milestones G0 to G8 in `rb-vor`, H1 to H4 here | `../rb-vor/docs/gs-plan.md` |
| GS marks on the HSI | Drawn, but fed by the slope to the direct-to waypoint (`$scope.to.slope`, from altitude difference over distance), not by a radio glideslope | `web/RB-01/plates/js/hsi.js` `calcRouting()`, `HSICircleRenderer.update(..., glideSlope)` |

The last row is the trap: a plate that shows "GS" marks moving today could be read as
glideslope reception. They are a GPS-computed vertical path.

## Proposal
Follow `../rb-vor/docs/gs-plan.md`; it is the brief and it is not repeated here. The parts
that land in this repository (its phase B, H1 to H4):

1. **Consume RB-VOR-IF v2.4** once phase A freezes it: the glideslope DDM and its status, on
   the float bridge, next to the `loc*` fields.
2. **Draw the glideslope only from a valid status.** As with the localizer bar, nothing is
   drawn below the valid states; noise must never read as "on the glide path".
3. **Keep the radio glideslope apart from the GPS slope.** Today both would use the same GS
   marks of `hsi.js`. Either label them differently or give the radio glideslope its own
   pointer, and say on the plate which one is shown.
4. **One dongle: a LOC / GS switch on the plate**, as the plan says, with the feature not
   selected showing nothing, never its last value.
5. **Wording.** "Supplemental, not approach guidance" wherever GS appears, as for LOC. The
   plan says a vertical needle invites more trust than a lateral one.
6. **Liveness.** A frozen glideslope looks like valid guidance. This needs the keep-alive
   that `radio-active-status.md` already asks for (TD2 in `../rb-sdr-radio/docs/tech-debt.md`).

## Done when
- A glideslope channel is decoded on synthetic signals across the ICAO tolerance, and on at
  least one real glideslope (G8), with the shipped default decided after that.
- The VOR plate shows the radio glideslope only with a valid status, labelled apart from the
  GPS slope, with the supplemental notice.
- `test/display` covers the plate with no signal, noise, a valid glideslope and a dead
  receiver, as `test_vor_loc.py` does for the localizer.
