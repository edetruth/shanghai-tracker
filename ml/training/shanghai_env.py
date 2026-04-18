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
    def __init__(self, player_count=2, opponent_ai=None, rich_state=False, rich_state_v2=False, rich_state_v3=False):
        self.player_count = player_count
        self.opponent_ai = opponent_ai  # e.g., "the-shark", "the-nemesis", None for random
        self.rich_state = rich_state
        self.rich_state_v2 = rich_state_v2
        self.rich_state_v3 = rich_state_v3
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
        if self.rich_state_v2:
            cmd["rich_state_v2"] = True
        if self.rich_state_v3:
            cmd["rich_state_v3"] = True
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

    def get_full_state(self, player: int = 0) -> dict:
        """Get the full state including raw hand data for data generation."""
        result = self._send({"cmd": "get_full_state", "player": player})
        if not result.get("ok"):
            raise RuntimeError(f"get_full_state failed: {result}")
        # V3: extract meld plan and opponent actions if present
        if self.rich_state_v3:
            result["meld_plan"] = result.get("meldPlan", [0.0] * 30)
            result["opponent_actions"] = result.get("opponentActionsSinceLast", [0.0] * 18)
        return result

    def evaluate_hand(self, player: int = 0) -> float:
        """Get the hand evaluation score for a player. Used for reward shaping."""
        result = self._send({"cmd": "evaluate_hand", "player": player})
        if not result.get("ok"):
            return 0.0
        return float(result.get("score", 0.0))

    def get_strategic_actions(self, meld_hook=None) -> tuple:
        """Get only strategic actions (draw/discard/buy). Auto-execute meld/layoff.

        Melds and layoffs are always executed first (they're almost always
        correct), then the remaining strategic actions are returned for the
        caller to decide.

        IMPORTANT: auto-execution runs for BOTH agent and opponents. Previously
        only player 0 got auto-meld, which gave the agent a massive asymmetric
        advantage — random opponents wouldn't meld even when they could, so
        they rarely went out and the agent won ~92% of games by default.

        meld_hook: Optional callable() -> bool.  Called when current_player == 0
        has a 'meld' action available and meld_hook is not None.
        Return False to SKIP meld for player 0 this turn (lay-down timing).
        Return True or None → execute meld as usual.

        Returns (actions, current_player, state) where state is the updated
        state vector after any auto-executed mechanical actions.
        """
        max_auto = 50  # safety cap to prevent infinite loops
        auto_count = 0
        latest_state = None
        while auto_count < max_auto:
            actions, current_player = self.get_valid_actions()
            if not actions:
                return [], current_player, latest_state

            # Always auto-execute mechanical actions (meld/layoff) first,
            # regardless of whose turn it is. This keeps the random/rule-based
            # opponent behavior symmetric with the agent's behavior.
            mechanical = [a for a in actions if a == "meld" or a.startswith("layoff:")]
            if mechanical:
                if "meld" in mechanical:
                    # For player 0: ask meld_hook before auto-executing
                    if meld_hook is not None and current_player == 0:
                        if meld_hook() is False:
                            # Hook said skip — remove meld, return strategic actions
                            actions_no_meld = [a for a in actions if a != "meld"]
                            strategic = [
                                a for a in actions_no_meld
                                if a in ("draw_pile", "take_discard", "buy", "decline_buy")
                                or a.startswith("discard:")
                            ]
                            if strategic:
                                return strategic, current_player, latest_state
                            return actions_no_meld, current_player, latest_state
                    latest_state, _, _, _ = self.step("meld")
                else:
                    latest_state, _, _, _ = self.step(mechanical[0])
                auto_count += 1
                continue  # Re-check: more melds/layoffs may now be available

            # No mechanical actions left — return strategic ones.
            # (Return for any player; caller decides whether it's the agent
            # or an opponent and routes the action accordingly.)
            strategic = [a for a in actions if a in ("draw_pile", "take_discard", "buy", "decline_buy") or a.startswith("discard:")]
            if strategic:
                return strategic, current_player, latest_state

            # Fallback: return whatever the bridge gave us
            return actions, current_player, latest_state

        # Safety: return whatever we have after max iterations
        actions, current_player = self.get_valid_actions()
        return actions, current_player, latest_state

    def get_ai_action(self) -> str:
        """Get the AI personality's recommended action for the current state."""
        result = self._send({"cmd": "get_ai_action"})
        if not result.get("ok"):
            raise RuntimeError(f"get_ai_action failed: {result}")
        return result["action"]

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
