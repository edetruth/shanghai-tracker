"""
ONNX export script for trained ShanghaiNet checkpoints.

Exports the model using forward_onnx() (returns a tuple — ONNX requirement).
Optionally verifies the export with onnxruntime if it is installed.

Output names (in order):
    discard_logits  (1, 53)
    draw_logits     (1, 2)
    buy_logit       (1, 1)
    laydown_logit   (1, 1)
    value           (1, 1)

Usage
-----
    cd ml/pimc
    python -m alphazero.export \\
        --checkpoint alphazero/checkpoints/best.pt \\
        --output alphazero/exports/shanghai_oracle.onnx
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

import torch

_PIMC_DIR = Path(__file__).parent.parent
if str(_PIMC_DIR) not in sys.path:
    sys.path.insert(0, str(_PIMC_DIR))

from alphazero.network import ShanghaiNet

OUTPUT_NAMES = ["discard_logits", "draw_logits", "buy_logit", "laydown_logit", "value"]
INPUT_NAME   = "state"


def export_onnx(
    model: ShanghaiNet,
    output_path: str,
    opset: int = 12,
    verify: bool = True,
) -> Path:
    """
    Export model to ONNX.

    Args:
        model:       trained ShanghaiNet (eval mode applied internally)
        output_path: destination .onnx file
        opset:       ONNX opset version (default 12 — broad runtime compat)
        verify:      run onnxruntime cross-check if available (default True)

    Returns:
        Path to the written .onnx file.

    Raises:
        RuntimeError if onnxruntime verification fails (output mismatch).
    """
    model.eval()
    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    dummy = torch.zeros(1, ShanghaiNet.STATE_DIM)

    torch.onnx.export(
        model,
        dummy,
        str(out_path),
        input_names  = [INPUT_NAME],
        output_names = OUTPUT_NAMES,
        dynamic_axes = {INPUT_NAME: {0: "batch"}, **{n: {0: "batch"} for n in OUTPUT_NAMES}},
        opset_version= opset,
    )
    print(f"Exported ONNX model → {out_path}  ({out_path.stat().st_size // 1024} KB)")

    if verify:
        _verify(model, out_path, dummy)

    return out_path


def _verify(model: ShanghaiNet, onnx_path: Path, dummy: torch.Tensor) -> None:
    try:
        import onnxruntime as ort
        import numpy as np
    except ImportError:
        print("  onnxruntime not installed — skipping verification")
        return

    pt_outs = model.forward_onnx(dummy)

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ort_outs = sess.run(None, {INPUT_NAME: dummy.numpy()})

    for name, pt, ort_o in zip(OUTPUT_NAMES, pt_outs, ort_outs):
        pt_np = pt.detach().numpy()
        if not (abs(pt_np - ort_o) < 1e-4).all():
            raise RuntimeError(
                f"ONNX verification failed for {name}: max diff "
                f"{abs(pt_np - ort_o).max():.6f}"
            )
    print("  ONNX verification passed — PyTorch and onnxruntime outputs match")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Export ShanghaiNet to ONNX")
    parser.add_argument("--checkpoint", required=True,  help="Path to .pt state dict")
    parser.add_argument("--warm-start", default=None,   help="Load via from_pimc_checkpoint")
    parser.add_argument("--output",     required=True,  help="Output .onnx file path")
    parser.add_argument("--opset",      type=int, default=12)
    parser.add_argument("--no-verify",  action="store_true")
    args = parser.parse_args()

    ckpt = Path(args.checkpoint)
    if args.warm_start:
        model = ShanghaiNet.from_pimc_checkpoint(ckpt)
    else:
        model = ShanghaiNet()
        model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True))

    export_onnx(model, args.output, opset=args.opset, verify=not args.no_verify)
