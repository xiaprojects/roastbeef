# Trim and flaps by voice, through the switchboard: announced, not built

## Problem
Trim and flaps by voice are announced as coming next. Today no voice command reaches the
switchboard, and the switchboard has no notion of a trim or flap actuator.

| Piece | State | Where |
|---|---|---|
| Voice | Handlers for the autopilot (direct-to), airfields, timers, traffic, display pages and the radio standby frequency, plus read-outs of `ems` and `situation`. No switchboard handler, no trim or flap keyword in any case file | `../rbvoice/assistant.py`, `rbvoice-cases.<lang>.json` |
| Switchboard, server | Runs a configured switch by index (`POST /switches/<n>`). Only `SW_TYPE_CMD` (a command line) is executed; any other type returns `SW_STATUS_FINISH_2`. `SW_TYPE_GPIO` is declared and not implemented | `main/managementinterface.go` `handleSwitchBoardPost`, `main/switchboard.go` |
| Switchboard, display | A list of the configured switches; one soft key away on the bottom bar (`SWITCH`) | `web/RB-01/plates/switchboard.html`, `plates/js/switchboard.js`, `js/main.js` soft keys |
| Trim and flap position | Sensed by RB-04, shown as engine data | `../rb-ems-go` |
| `SwitchBoard_Enabled` | Defaults to false | `main/gen_gdl90.go` `defaultSettings()` |

## Proposal
A voice command that moves a control surface is a safety function, so the design starts
from what must confirm and limit it, and the code follows.

What must confirm or limit such an action (requirements to write, for the FHA in
`docs/certification/fha.md`):

1. **Explicit intent and a clear match**, as for the autopilot today: only from dedicated
   keywords, never as a side effect of another component, and refused below a clear-match
   score with a spoken "not understood".
2. **Read-back before acting**: RB-01 repeats the command and acts only on a spoken or
   physical confirmation within a short window. No confirmation, no movement.
3. **Bounded steps, never "until"**: one command moves trim by a fixed step or for a fixed
   time; flaps go to a named detent. Nothing runs open-ended.
4. **Limits from the aircraft profile**: a flap extension speed, which `aircraft.json` does
   not carry yet, checked against the airspeed; trim end stops from the RB-04 position; refused, with the reason
   spoken, outside them.
5. **Position feedback**: the action is reported done only when the RB-04 position shows it,
   and a mismatch after the step is announced.
6. **The pilot's own switch wins**: the existing trim and flap switches stay in the circuit
   and override any relay the switchboard drives; a fault leaves the relay open.
7. **Logged**: every command, confirmation and result goes to the flight log.

What is missing, by repository:

- **rbvoice**: a `switchboard` (or `controls`) component in every case file, a handler that
  implements rules 1 to 3, the confirmation dialogue, tests in `tests/test_integration.py`
  against the fake RB-01, and vocabulary checks for the new keywords in each language.
- **roastbeef**: a switch type for an actuator with a bounded action (step or detent),
  limits read from the aircraft profile and the RB-04 position, an endpoint that runs one
  bounded action and returns its result, implementation of rules 4 to 7, and display
  feedback on the switchboard plate. `SW_TYPE_GPIO` would need implementing first.
- **Hardware**: a documented relay or driver interface for trim and flap motors, wired so
  that rule 6 holds.

## Done when
- The requirements above are written and traced, with FHA rows for an uncommanded, a wrong
  and a missing movement.
- A trim step and a flap detent can be commanded by voice on the bench, with read-back,
  confirmation, limits and position feedback, and refused when a limit applies.
- Tests in both repositories cover a misheard command, no confirmation, a limit, and a
  position that does not follow.
