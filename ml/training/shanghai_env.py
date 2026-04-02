"""
Shanghai Rummy environment — wraps the Node.js game bridge.
Provides a gym-like interface for reinforcement learning.

Usage:
    env = ShanghaiEnv(player_count=2)
    state = env.reset(seed=42)
    while not done:
        actions = env.get_valid_actions()
        action = agent.choose(state, actions)
        state, reward, done, info = env.step(action)
"""

import subprocess
import json
import os
from pathlib import Path

BRIDGE_DIR = Path(__file__).parent.parent / "bridge"

class ShanghaiEnv:
    def __init__(self, player_count=2, opponent_ai=None, rich_state=False):
        self.player_count = player_count
        self.opponent_ai = opponent_ai  # e.g., "the-shark", "the-nemesis", None for random
        self.rich_state = rich_state
        self.proc = None
        self._start_bridge()

    def _start_bridge(self):
        """Start the Node.js game bridge as a subprocess."""
        bridge_script = BRIDGE_DIR / "game-bridge.ts"
        # Use ts-node or tsx to run TypeScript directly
        self.proc = subprocess.Popen(
            f'npx tsx "{bridge_script}"',
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(BRIDGE_DIR.parent.parent),  # project root
            bufsize=1,
            shell=True,  # needed on Windows to find npx on PATH
        )

    def _send(self, cmd: dict) -> dict:
        """Send a JSON command and read the response."""
        if not self.proc or self.proc.poll() is not None:
            self._start_bridge()
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline().strip()
        if not line:
            raise RuntimeError("Bridge process returned empty response")
        return json.loads(line)

    def reset(self, seed=None) -> list:
        """Start a new game. Returns the initial state vector."""
        import random
        if seed is None:
            seed = random.randint(0, 2147483647)
        cmd = {"cmd": "new_game", "players": self.player_count, "seed": seed}
        if self.opponent_ai:
            cmd["opponent_ai"] = self.opponent_ai
        if self.rich_state:
            cmd["rich_state"] = True
        result = self._send(cmd)
        if not result.get("ok"):
            raise RuntimeError(f"Failed to start game: {result}")
        return result["state"]

    def get_valid_actions(self) -> list:
        """Get the list of valid actions for the current player."""
        result = self._send({"cmd": "get_actions"})
        return result.get("actions", []), result.get("currentPlayer", 0)

    def step(self, action: str) -> tuple:
        """Take an action. Returns (state, reward, done, info)."""
        result = self._send({"cmd": "take_action", "action": action})
        if not result.get("ok"):
            raise RuntimeError(f"Action failed: {result}")
        return (
            result["state"],
            result["reward"],
            result["done"],
            {
                "phase": result.get("phase"),
                "round": result.get("round"),
                "currentPlayer": result.get("currentPlayer"),
                "scores": result.get("scores"),
            },
        )

    def close(self):
        """Shut down the bridge."""
        if self.proc:
            try:
                self._send({"cmd": "quit"})
            except:
                pass
            self.proc.terminate()
            self.proc = None

    def __del__(self):
        self.close()
