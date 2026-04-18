"""
PIMCNet vs real AI evaluation — runs through the TypeScript game bridge.

Player 0 uses a trained network (v1 or v2, auto-detected) for discard decisions.
Players 1-3 use the specified TypeScript AI personality (mastermind, shark, nemesis).

Mirrors pimc_bridge_eval.py but replaces PIMC rollouts with a single ~1ms
forward pass per decision.  50 games takes ~20-30 min (bridge round-trip
is the bottleneck, not inference).

Model auto-detection: v2 checkpoints (no draw_head) force --discard-only automatically.

Usage:
    python network_bridge_eval.py --games 50 --opponent the-mastermind
    python network_bridge_eval.py --games 50 --model network_v2.pt --opponent the-mastermind
    python network_bridge_eval.py --games 50 --opponent the-shark
    python network_bridge_eval.py --games 50 --discard-only --opponent the-mastermind
"""

import argparse
import json
import sys
import time
from pathlib import Path
from statistics import mean, stdev

import torch

# ── Path setup ────────────────────────────────────────────────────
_HERE        = Path(__file__).parent
_TRAINING    = _HERE.parent / "training"
if str(_HERE)     not in sys.path: sys.path.insert(0, str(_HERE))
if str(_TRAINING) not in sys.path: sys.path.insert(0, str(_TRAINING))

from shanghai_env import ShanghaiEnv
from evaluate_pimc import _Tee
from evaluate_network import NetworkHook, load_model, HUMAN_AVG, MASTERMIND_AVG, PIMC_40R_AVG
# load_model auto-detects v1 (dual-head PIMCNet) vs v2 (PIMCDiscardNet)

from engine import find_meld_assignment, ROUND_REQS, CARDS_DEALT as _CARDS_DEALT_LD
from collect_data import build_laydown_state_vec, LAYDOWN_STATE_DIM

# LaydownNet imported lazily (only if laydown_net.pt exists)


# ── Card encoding: TypeScript <-> Python int ──────────────────────
# Mirrors pimc_bridge_eval.py exactly.

JOKER_INT = 64
_SUIT_TS_TO_INT = {'clubs': 0, 'diamonds': 1, 'hearts': 2, 'spades': 3}
_SUIT_INT_TO_TS = {0: 'clubs', 1: 'diamonds', 2: 'hearts', 3: 'spades'}
_SUIT_ORDER_TS  = {'hearts': 0, 'diamonds': 1, 'clubs': 2, 'spades': 3, 'joker': 4}


def _ts_to_int(card: dict) -> int:
    if card['suit'] == 'joker':
        return JOKER_INT
    return _SUIT_TS_TO_INT[card['suit']] * 16 + card['rank']


def _ts_sort_key(card: dict) -> tuple:
    rank = 14 if card['suit'] == 'joker' else card['rank']
    return (rank, _SUIT_ORDER_TS[card['suit']], card.get('id', ''))


def _find_discard_index(hand_cards: list, chosen_int: int) -> int:
    """Return the sorted hand index for chosen_int (bridge expects discard:N)."""
    if chosen_int == JOKER_INT:
        target_suit, target_rank = 'joker', 0
    else:
        target_suit = _SUIT_INT_TO_TS[chosen_int >> 4]
        target_rank = chosen_int & 15

    sorted_hand = sorted(hand_cards, key=_ts_sort_key)
    for i, c in enumerate(sorted_hand):
        if c['suit'] == target_suit and c['rank'] == target_rank:
            return i
    return len(sorted_hand) - 1   # fallback: last card


# ── Lay-down timing hook ──────────────────────────────────────────

class LaydownHook:
    """
    Wraps LaydownNet as a no-arg callable for use with get_strategic_actions(meld_hook=).

    Called when player 0 has a meld opportunity. Fetches full state from the
    bridge, reconstructs the lay-down state vector, and returns True/False.
    """

    def __init__(self, model, env, n_players: int):
        self._model       = model
        self._env         = env
        self._n_players   = n_players
        self.decisions    = 0
        self.skipped      = 0
        self._last_round  = -1    # round when we last skipped
        self._skipped_this_round = False

    def __call__(self) -> bool:
        """Return True to lay down now, False to skip this turn.

        Mirrors _SkipOnceLaydownHook from training: at most one skip per round,
        then always go down. Without this guard the hook keeps saying 'wait'
        every turn and player 0 never lays down.
        """
        full      = self._env.get_full_state()
        round_idx = max(0, full.get('round', 1) - 1)

        # New round — reset skip flag
        if round_idx != self._last_round:
            self._last_round         = round_idx
            self._skipped_this_round = False

        # Already waited once this round — must go down now
        if self._skipped_this_round:
            return True

        hand_cards = full.get('hand', [])
        hand_ints  = [_ts_to_int(c) for c in hand_cards]

        req_sets, req_runs = ROUND_REQS[round_idx]
        assignment = find_meld_assignment(hand_ints, req_sets, req_runs)
        if assignment is None:
            return True   # no valid assignment — shouldn't happen; default to meld

        opp_sizes     = [_CARDS_DEALT_LD[round_idx]] * (self._n_players - 1)
        has_ld_others = [False] * (self._n_players - 1)   # approximate

        sv      = build_laydown_state_vec(
            hand=hand_ints,
            assignment=assignment,
            round_idx=round_idx,
            has_laid_down_others=has_ld_others,
            opp_sizes=opp_sizes,
        )
        state_t = torch.from_numpy(sv).unsqueeze(0)
        pred    = int(self._model.predict(state_t).item())   # 1=meld, 0=skip

        self.decisions += 1
        if pred == 0:
            self.skipped          += 1
            self._skipped_this_round = True
        return bool(pred)


# ── Single game ───────────────────────────────────────────────────

def run_one_game(
    env: ShanghaiEnv,
    model,
    n_players: int,
    seed: int,
    discard_only: bool = False,
    laydown_hook=None,
) -> tuple:
    """
    Play one game with PIMCNet as player 0.

    Returns:
        (scores list, hook) — hook exposes .decisions and .fallbacks
    """
    env.reset(seed=seed)
    hook = NetworkHook(model=model, player_idx=0, n_players=n_players)

    done   = False
    info   = {}
    step   = 0
    max_steps = 8000   # 7 rounds × ~200 turns × ~5 steps/turn

    while not done and step < max_steps:
        step += 1
        actions, current_player, _ = env.get_strategic_actions(meld_hook=laydown_hook)

        if not actions:
            break

        # ── Buy window ────────────────────────────────────────────
        if 'buy' in actions or 'decline_buy' in actions:
            ai_resp = env._send({'cmd': 'get_ai_action'})
            action  = ai_resp.get('action', 'decline_buy')
            _, _, done, info = env.step(action)
            continue

        # ── Fetch state from bridge ───────────────────────────────
        full       = env.get_full_state()
        hand_cards = full.get('hand', [])
        hand_ints  = [_ts_to_int(c) for c in hand_cards]
        round_idx  = max(0, full.get('round', 1) - 1)   # 0-indexed
        has_ld     = full.get('hasLaidDown', False)

        # ── Draw decision ─────────────────────────────────────────
        if 'draw_pile' in actions or 'take_discard' in actions:
            discard_top = full.get('discardTop')
            discard_int = _ts_to_int(discard_top) if discard_top else -1

            if not discard_only and discard_int >= 0 and 'take_discard' in actions:
                decision = hook.draw(0, hand_ints, discard_int, has_ld, round_idx)
                action   = 'take_discard' if decision == 'take' else 'draw_pile'
            elif discard_int >= 0 and 'take_discard' in actions:
                # Discard-only mode: always draw from pile (no draw head)
                # NOTE: changing this without retraining hurts the discard policy
                # (distribution shift). Draw fix requires co-training — see Phase 2.
                action = 'draw_pile'
            else:
                action = 'draw_pile'

            _, _, done, info = env.step(action)
            continue

        # ── Discard decision ──────────────────────────────────────
        discard_actions = [a for a in actions if a.startswith('discard:')]
        if discard_actions:
            chosen_int = hook.discard(0, hand_ints, has_ld, [], round_idx)
            if chosen_int is not None:
                idx    = _find_discard_index(hand_cards, chosen_int)
                action = f'discard:{idx}'
            else:
                action = discard_actions[-1]   # fallback: last sorted card
            _, _, done, info = env.step(action)
            continue

        # ── Fallback ──────────────────────────────────────────────
        _, _, done, info = env.step(actions[0])

    return info.get('scores', [0] * n_players), hook


# ── Evaluation loop ───────────────────────────────────────────────

def run_evaluation(
    n_games: int,
    n_players: int,
    opponent: str,
    seed: int,
    model,
    discard_only: bool = False,
    laydown_hook=None,
) -> dict:
    import random as _random

    env        = ShanghaiEnv(player_count=n_players, opponent_ai=opponent)
    if laydown_hook is not None:
        laydown_hook._env = env
    rng        = _random.Random(seed)
    p0_scores  = []
    opp_avgs   = []
    wins       = 0
    total_dec  = 0
    total_fb   = 0
    t_start    = time.perf_counter()

    for game_i in range(n_games):
        game_seed          = rng.randint(0, 2 ** 31 - 1)
        scores, hook       = run_one_game(env, model, n_players, game_seed, discard_only,
                                          laydown_hook=laydown_hook)

        p0_scores.append(scores[0])
        opp_avgs.append(mean(scores[1:]))
        if scores[0] == min(scores):
            wins += 1
        total_dec += hook.decisions
        total_fb  += hook.fallbacks

        elapsed = time.perf_counter() - t_start
        rate    = (game_i + 1) / elapsed
        print(
            f"  game {game_i+1:4d}/{n_games}"
            f"  p0={mean(p0_scores):5.0f}"
            f"  opp={mean(opp_avgs):5.0f}"
            f"  wr={wins/(game_i+1):.0%}"
            f"  {rate:.2f}g/s",
            flush=True,
        )

    env.proc.terminate()

    avg = lambda v: mean(v) if v else 0.0
    sd  = lambda v: stdev(v) if len(v) > 1 else 0.0
    result = {
        "n_games":      n_games,
        "n_players":    n_players,
        "opponent":     opponent,
        "p0_avg":       avg(p0_scores),
        "p0_std":       sd(p0_scores),
        "opp_avg":      avg(opp_avgs),
        "opp_std":      sd(opp_avgs),
        "win_rate":     wins / n_games,
        "p0_scores":    p0_scores,
        "decisions":    total_dec,
        "fallbacks":    total_fb,
        "discard_only": discard_only,
    }
    if laydown_hook is not None:
        result["ld_decisions"] = laydown_hook.decisions
        result["ld_skipped"]   = laydown_hook.skipped
    return result


# ── Report ────────────────────────────────────────────────────────

def _save_report(results: dict, model_name: str, elapsed: float) -> None:
    log_dir = _HERE / "logs"
    log_dir.mkdir(exist_ok=True)
    ts   = time.strftime("%Y%m%d_%H%M%S")
    stem = f"network_bridge_{ts}"

    json_path = log_dir / f"{stem}.json"
    json_path.write_text(
        json.dumps({
            **{k: v for k, v in results.items() if k != "p0_scores"},
            "model":       model_name,
            "elapsed_sec": round(elapsed, 1),
            "timestamp":   time.strftime("%Y-%m-%d %H:%M:%S"),
        }, indent=2),
        encoding="utf-8",
    )

    p0_avg   = results["p0_avg"]
    opp_avg  = results["opp_avg"]
    mode_lbl = "discard-only" if results["discard_only"] else "discard+draw"
    lines = [
        f"PIMCNet ({mode_lbl}) vs {results['opponent']} — {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"Model: {model_name}  Games: {results['n_games']}  Players: {results['n_players']}  Time: {elapsed/3600:.2f}h",
        "",
        f"  PIMCNet (P0)          : {p0_avg:6.1f}  +/- {results['p0_std']:.1f}",
        f"  {results['opponent']} (P1+): {opp_avg:6.1f}  +/- {results['opp_std']:.1f}",
        f"  Score delta (net better): {opp_avg - p0_avg:+.1f}",
        f"  Win rate              : {results['win_rate']:.1%}  (random={1/results['n_players']:.0%})",
        "",
        f"  vs Human (227)        : {HUMAN_AVG - p0_avg:+.1f}",
        f"  vs Mastermind (219)   : {MASTERMIND_AVG - p0_avg:+.1f}",
        f"  vs PIMC-40R (220)     : {PIMC_40R_AVG - p0_avg:+.1f}",
    ]
    if results["fallbacks"]:
        lines.append(f"\n  Fallbacks: {results['fallbacks']}/{results['decisions']} (masking issue)")

    txt_path = log_dir / f"{stem}.txt"
    txt_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"\nReport saved:")
    print(f"  {json_path}")
    print(f"  {txt_path}")


# ── CLI ───────────────────────────────────────────────────────────

def main() -> None:
    # Tee logging
    log_dir  = _HERE / "logs"
    log_dir.mkdir(exist_ok=True)
    log_path = log_dir / "network_bridge_eval.log"
    fh = open(log_path, "a", encoding="utf-8")
    fh.write(f"\n{'='*60}\n")
    fh.write(f"Run started: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    fh.write(f"Args: {' '.join(sys.argv[1:])}\n")
    fh.write(f"{'='*60}\n")
    sys.stdout = _Tee(sys.__stdout__, fh)
    sys.stderr = _Tee(sys.__stderr__, fh)

    parser = argparse.ArgumentParser(
        description="Evaluate PIMCNet vs real TypeScript AI opponents"
    )
    parser.add_argument("--games",        type=int,  default=50,
                        help="Games to play (default: 50)")
    parser.add_argument("--players",      type=int,  default=4,
                        help="Number of players (default: 4)")
    parser.add_argument("--opponent",     type=str,  default="the-mastermind",
                        choices=["the-mastermind", "the-shark", "the-nemesis"],
                        help="TypeScript AI for P1-P{n-1} (default: the-mastermind)")
    parser.add_argument("--seed",         type=int,  default=42,
                        help="RNG seed (default: 42)")
    parser.add_argument("--model",        type=str,  default="network_v1.pt",
                        help="Checkpoint filename in models/ (default: network_v1.pt)")
    parser.add_argument("--discard-only", action="store_true",
                        help="Network discard only; greedy draw (no draw_hook)")
    parser.add_argument("--no-laydown",  action="store_true",
                        help="Force greedy lay-down (skip LaydownNet even if present)")
    args = parser.parse_args()

    model_path = _HERE / "models" / args.model
    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}", file=sys.stderr)
        sys.exit(1)

    mode_str = "discard-only (greedy draw)" if args.discard_only else "discard + draw"

    print(f"Network Bridge Evaluator")
    print(f"  Player 0   : PIMCNet ({model_path.name}, {mode_str})")
    print(f"  Players 1-{args.players-1}: {args.opponent}")
    print(f"  Games      : {args.games}  |  Seed: {args.seed}")
    print(f"  Benchmarks : Human={HUMAN_AVG:.0f}  Mastermind={MASTERMIND_AVG:.0f}  PIMC-40R={PIMC_40R_AVG:.0f}")
    print()

    model, is_v2 = load_model(model_path)
    if is_v2:
        args.discard_only = True   # v2 has no draw head
    n_params = sum(p.numel() for p in model.parameters())
    model_tag = "v2 discard-only" if is_v2 else "v1 dual-head"
    print(f"  Model loaded: {n_params:,} parameters  ({model_tag})")

    # ── Load lay-down net (optional) ─────────────────────────────────
    laydown_hook = None
    if not args.no_laydown:
        ld_path = _HERE / "models" / "laydown_net.pt"
        if ld_path.exists():
            from laydown_net import LaydownNet
            ld_model = LaydownNet()
            ld_model.load_state_dict(
                torch.load(ld_path, map_location="cpu", weights_only=True)
            )
            ld_model.eval()
            # env assigned inside run_evaluation after ShanghaiEnv is created
            laydown_hook = LaydownHook(ld_model, env=None, n_players=args.players)
            print(f"  LaydownNet loaded: {ld_path.name}")
        else:
            print(f"  LaydownNet not found ({ld_path.name}) — using greedy lay-down")
    else:
        print("  Lay-down timing: greedy (--no-laydown)")
    print()

    t0      = time.perf_counter()
    results = run_evaluation(
        n_games=args.games,
        n_players=args.players,
        opponent=args.opponent,
        seed=args.seed,
        model=model,
        discard_only=args.discard_only,
        laydown_hook=laydown_hook,
    )
    elapsed = time.perf_counter() - t0

    p0_avg  = results["p0_avg"]
    opp_avg = results["opp_avg"]
    print(f"\nResults ({elapsed:.0f}s):")
    print(f"  PIMCNet (P0)            : avg {p0_avg:6.1f}  +/- {results['p0_std']:.1f}")
    print(f"  {args.opponent} (P1+)   : avg {opp_avg:6.1f}  +/- {results['opp_std']:.1f}")
    print(f"  Score delta (net better): {opp_avg - p0_avg:+.1f}")
    print(f"  Win rate                : {results['win_rate']:.1%}  (random={1/args.players:.0%})")
    print(f"  vs Human (227)          : {HUMAN_AVG - p0_avg:+.1f}")
    print(f"  vs Mastermind (219)     : {MASTERMIND_AVG - p0_avg:+.1f}")
    print(f"  vs PIMC-40R (220)       : {PIMC_40R_AVG - p0_avg:+.1f}")
    if "ld_decisions" in results:
        ld_d = results["ld_decisions"]
        ld_s = results["ld_skipped"]
        skip_pct = ld_s / max(ld_d, 1)
        print(f"  LaydownNet decisions    : {ld_d}  skipped={ld_s} ({skip_pct:.0%})")

    _save_report(results, model_path.name, elapsed)


if __name__ == "__main__":
    main()
