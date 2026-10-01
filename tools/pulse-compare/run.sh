#!/usr/bin/env bash
# Runs the same PEEP ladder on Pulse (through BREATHE's engine) and on NodeSim, then writes
# out/confronto.md with the two side by side.
#   tools/pulse-compare/run.sh /path/to/BREATHE/breathe.engine [stabilize_s step_s]
# Needs Java 17+ and Node 18+. Pulse runs about 10-20x faster than real time: the default
# (10 min to stabilize, 10 min per PEEP level) takes a few minutes per severity.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ENGINE=$(cd "${1:?usage: run.sh /path/to/breathe.engine [stabilize_s step_s]}" && pwd)
STAB=${2:-600}
STEP=${3:-600}
SEVERITIES=${SEVERITIES:-"0 0.6 0.85"}
OUT="$HERE/out"
mkdir -p "$OUT/classes"
javac -proc:none -cp "$ENGINE/jar/*" -d "$OUT/classes" "$HERE/PeepLadder.java"
for s in $SEVERITIES; do
	( cd "$ENGINE" && java -cp "jar/*:$OUT/classes" PeepLadder "$s" "$STAB" "$STEP" 2>/dev/null | grep -E '^(#|PEEP|[0-9])' ) > "$OUT/pulse_$s.tsv" &
	node "$HERE/nodesim_ladder.js" "$s" "$STAB" "$STEP" > "$OUT/nodesim_$s.tsv"
done
wait
node "$HERE/compare.js" "$OUT" > "$OUT/confronto.md"
echo "Scritto $OUT/confronto.md"
