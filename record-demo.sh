#!/usr/bin/env bash
# Records a region to ~/Downloads/ailedger-speedrun.mp4 with mic audio.
# Drag a rectangle when slurp fires. Ctrl+C to stop.
set -e

OUT="$HOME/Downloads/ailedger-speedrun-$(date +%Y%m%d-%H%M%S).mp4"
MIC="alsa_input.pci-0000_00_1f.3.analog-stereo"

echo "Select a region to record..."
REGION="$(slurp)"
echo "Recording to $OUT (Ctrl+C to stop)"

wf-recorder \
  -g "$REGION" \
  -f "$OUT" \
  -x yuv420p \
  -r 30 \
  --audio="$MIC" \
  --audio-codec=aac \
  -P b:a=192k \
  --sample-rate=48000

echo "Saved: $OUT"
