"""Shared logging utility — tees stdout/stderr to a log file."""

import sys
import time
from pathlib import Path


class Tee:
    def __init__(self, *streams):
        self.streams = streams

    def write(self, data):
        for s in self.streams:
            s.write(data)
            s.flush()

    def flush(self):
        for s in self.streams:
            s.flush()


def setup_logging(script_name: str):
    """Tee stdout/stderr to ml/training/logs/<script_name>.log.

    Appends to the log file so history accumulates across runs.
    """
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / f"{script_name}.log"

    log_fh = open(log_file, "a", encoding="utf-8")
    log_fh.write(f"\n{'='*60}\n")
    log_fh.write(f"Run started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    log_fh.write(f"Args: {' '.join(sys.argv[1:])}\n")
    log_fh.write(f"{'='*60}\n")
    sys.stdout = Tee(sys.__stdout__, log_fh)
    sys.stderr = Tee(sys.__stderr__, log_fh)
