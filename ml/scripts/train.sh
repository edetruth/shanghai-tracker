#!/usr/bin/env bash
# Run PPO training with timestamped log file
# Usage: bash ml/scripts/train.sh [extra ppo.py args...]
#
# Examples:
#   bash ml/scripts/train.sh
#   bash ml/scripts/train.sh --games 5000
#   bash ml/scripts/train.sh --games 20000 --batch-size 20

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TRAINING_DIR="$SCRIPT_DIR/../training"
LOG_DIR="$SCRIPT_DIR/../training/logs"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="$LOG_DIR/training_${TIMESTAMP}.txt"

echo "Training log: $LOG_FILE"
echo ""

cd "$TRAINING_DIR"
python -u ppo.py --games 10000 --batch-size 10 --fresh --curriculum "$@" 2>&1 | tee "$LOG_FILE"
