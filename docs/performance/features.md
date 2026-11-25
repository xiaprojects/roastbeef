# Aircraft performance monitoring: features and benefits

*Website copy. The claims below match what the open reference algorithm does today. The
closed-source professional algorithms are marked as such.*

## Know how your aircraft is really performing today

Every flight, RB-01 compares your aircraft with **itself**: with the way it flew when it
was clean, healthy and normally loaded. It needs no manufacturer tables and no extra
sensors. The comparison runs in the background while you fly. One page shows the result
as simple percentages: **100 % is your aircraft at its best**.

## What you see

One screen with one bar per indicator, in the same colours as your G-meter: green, yellow
and red.

- **CRUISE**: are you as fast as usual at this RPM? A dirty airframe, a missing wheel
  fairing, ice or a tired engine show up here first.
- **ATTITUDE**: does the wing need more angle than usual to hold altitude? That is the
  signature of extra weight, an aft CG or ice on the wing. Give it your reference mass and
  it estimates the weight you are flying at.
- **CLIMB**: is the aircraft climbing as it should for today's altitude and temperature?
- **ENGINE**: is full power still full power?
- **FUEL**: are the cylinders burning evenly, and is the engine running smoothly? Dirty
  fuel, a fouled plug or a partly blocked injector show up here as uneven exhaust
  temperatures and a rough RPM.
- **DENSITY**: how much power the hot summer air is costing you, compared with a standard
  day at the same altitude.
- **ICING**: how close the air is to carburettor or airframe icing conditions.
- **OVERALL**: one number for the whole picture.

## Benefits

- **Catch problems early.** A slow loss of a few percent is invisible from the cockpit, but
  it is clear when the aircraft is compared with itself flight after flight.
- **Fly with numbers on hot days.** DENSITY and CLIMB show what high temperatures take
  away before you are at the end of the runway.
- **Spot the loading mistake.** ATTITUDE and CLIMB together read like a heavier aircraft
  when you are heavier than you think.
- **Fuel quality you can see.** You don't wait for the engine to cough: uneven cylinders
  appear on the FUEL bar.
- **Your aircraft, not a fleet average.** The reference is trained on your own recorded
  flights, so the thresholds fit your airframe, your propeller and your sensors.
- **No extra hardware.** It uses the sensors RB-01 already has: GPS, attitude, baro,
  airspeed and the engine monitor. Each indicator works with whatever sensors are fitted
  and says what it is missing.
- **Honest by design.** When the aircraft is outside the conditions it was trained in, the
  indicator says so (OUT OF RANGE) instead of guessing. Every value states what it
  compared, for example "149 kt TAS / 151 @ 2200 rpm".
- **Every flight is recorded.** Your flight logs already hold everything needed to train,
  retrain or review the indicators later.

## How it learns

1. Fly normally with RB-01 recording, as it always does.
2. Train on a few flights: the tool picks out the steady cruise and climb segments and
   learns your aircraft's numbers.
3. From then on, every flight is compared with that reference.

Retrain after a propeller change, a new engine or a major modification, and the new state
becomes the 100 %.

## Open and professional

- **Community edition (open source):** the reference algorithm above, the training tools
  and the page. It is free for builders and personal use.
- **Professional algorithms (commercial, closed source):** deeper models that plug into
  the same page. They add icing detection from performance loss, weight and balance
  estimation, engine health trends, fuel contamination detection and fleet comparison.
  Contact XIAPROJECTS for licensing.

## Fine print

Performance indicators are advisory. They do not replace the pilot's operating handbook,
weight and balance calculation, preflight inspection or engine monitoring limits. An
indicator can only be as good as its training and the sensors behind it.
