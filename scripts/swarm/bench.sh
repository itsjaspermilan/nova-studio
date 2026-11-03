#!/bin/bash
# Probe 1's benchmark: how the frame cost of Ember Swarm grows with the number of enemies (headless, so it measures
# the engine on this computer, not a handheld). Each F5 press asks for a hundred more enemies and turns on god mode.
#   scripts/swarm/bench.sh [100 300 600 1000]
cd "$(dirname "$0")/../.."
counts=${@:-100 300 600 1000}
for n in $counts; do
  presses=(--press key:F9@1)
  for ((i = 0; i < n / 100; i++)); do presses+=(--press key:F5@$((2 + i * 3))); done
  out=$(scripts/env.sh cargo run -q --release -p nova-runtime --bin nova -- run examples/ember-swarm --headless --frames 900 "${presses[@]}" 2>&1)
  echo "== $n enemies"
  echo "$out" | grep -E "^headless|^where|^last frame"
done
