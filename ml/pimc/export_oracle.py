"""
Export network_v7.pt (PIMCNet) for the in-app Oracle AI.

Produces:
  src/game/oracle-weights.json           — arch metadata + base64 float32 tensors
  src/game/__tests__/fixtures/oracle-fixtures.json
                                         — golden decision fixtures: raw inputs,
                                           the 170-dim state vec, forward outputs,
                                           and the masked decision, for bit-level
                                           verification of the TS port.

Usage:
    python export_oracle.py [--model network_v7.pt] [--fixtures 48] [--seed 7]
"""

import argparse
import base64
import json
import random
import sys
from pathlib import Path

import numpy as np
import torch

_HERE = Path(__file__).parent
_REPO = _HERE.parent.parent
_TRAINING = _REPO / "ml" / "training"
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
if str(_TRAINING) not in sys.path:
    sys.path.insert(0, str(_TRAINING))

from engine import make_deck, JOKER_INT, CARDS_DEALT   # noqa: E402
from collect_data import build_state_vec, _ctype       # noqa: E402
from train_network import PIMCNet                       # noqa: E402
from log_utils import setup_logging                     # noqa: E402


def _b64(t: torch.Tensor) -> str:
    return base64.b64encode(
        t.detach().cpu().contiguous().numpy().astype(np.float32).tobytes()
    ).decode("ascii")


def export_weights(model: PIMCNet, model_name: str, out_path: Path) -> None:
    sd = model.state_dict()
    tensors = {}
    for name, t in sd.items():
        tensors[name] = {"shape": list(t.shape), "data": _b64(t)}
    payload = {
        "format": "pimcnet-v1",
        "source": model_name,
        "stateDim": 170,
        "hidden": 256,
        "nParams": sum(t.numel() for t in sd.values()),
        "layerNormEps": 1e-5,
        "tensors": tensors,
    }
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(f"weights  -> {out_path}  ({out_path.stat().st_size / 1e6:.2f} MB, "
          f"{payload['nParams']:,} params)")


def _random_hand(rng: random.Random, size: int) -> list:
    deck = make_deck(2)
    rng.shuffle(deck)
    return deck[:size]


def make_fixtures(model: PIMCNet, n: int, seed: int, out_path: Path) -> None:
    rng = random.Random(seed)
    fixtures = []
    for i in range(n):
        round_idx = rng.randrange(7)
        hand_size = CARDS_DEALT[round_idx] + rng.choice([-2, -1, 0, 1, 2, 3])
        hand_size = max(2, hand_size)
        hand = _random_hand(rng, hand_size)
        has_laid_down = rng.random() < 0.3
        is_draw = i % 2 == 0
        discard_top = rng.choice([c for c in make_deck(1) if c != JOKER_INT]) if is_draw else -1
        opp_sizes = [CARDS_DEALT[round_idx]] * 3

        sv = build_state_vec(
            hand=hand, seen_dict={}, discard_top=discard_top,
            round_idx=round_idx, has_laid_down=has_laid_down, opp_sizes=opp_sizes,
        )
        state_t = torch.from_numpy(sv).unsqueeze(0)
        with torch.no_grad():
            discard_logits, draw_logit = model(state_t)

        fx = {
            "kind": "draw" if is_draw else "discard",
            "handInts": hand,
            "handTypes": [_ctype(c) for c in hand],
            "discardTopInt": discard_top,
            "roundIdx": round_idx,
            "hasLaidDown": has_laid_down,
            "stateVec": [float(x) for x in sv],
            "discardLogits": [float(x) for x in discard_logits.squeeze(0)],
            "drawLogit": float(draw_logit.squeeze()),
        }
        if is_draw:
            fx["expectedTake"] = bool(int(model.predict_draw(state_t).item()) == 1)
        else:
            fx["expectedDiscardType"] = int(model.predict_discard(state_t).item())
        fixtures.append(fx)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({"fixtures": fixtures}, indent=1), encoding="utf-8")
    print(f"fixtures -> {out_path}  ({len(fixtures)} cases)")


def main() -> None:
    setup_logging("export_oracle")
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="network_v7.pt")
    ap.add_argument("--fixtures", type=int, default=48)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    model_path = _HERE / "models" / args.model
    state_dict = torch.load(model_path, map_location="cpu", weights_only=True)
    model = PIMCNet()
    model.load_state_dict(state_dict)
    model.eval()

    export_weights(model, args.model, _REPO / "src" / "game" / "oracle-weights.json")
    make_fixtures(model, args.fixtures, args.seed,
                  _REPO / "src" / "game" / "__tests__" / "fixtures" / "oracle-fixtures.json")


if __name__ == "__main__":
    main()
