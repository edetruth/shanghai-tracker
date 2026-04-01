"""
Export trained PyTorch model to ONNX format for browser inference.

Usage:
    python export_model.py

Reads:  ml/models/shanghai_policy_best.pt (or shanghai_policy.pt)
Writes: ml/models/shanghai_oracle.onnx
        public/models/shanghai_oracle.onnx (for the web app)

The exported model takes a state vector (65 floats) and outputs:
  - policy: (MAX_ACTIONS,) action logits
  - value: (1,) expected reward
"""

import shutil
from pathlib import Path

import torch

from network import ShanghaiNet, STATE_SIZE, MAX_ACTIONS

MODELS_DIR = Path(__file__).parent.parent / "models"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "models"


def export():
    # Load best model (or latest)
    best_path = MODELS_DIR / "shanghai_policy_best.pt"
    latest_path = MODELS_DIR / "shanghai_policy.pt"
    model_path = best_path if best_path.exists() else latest_path

    if not model_path.exists():
        print(f"No model found at {model_path}")
        print("Train a model first: python self_play.py --games 1000")
        return

    print(f"Loading model from {model_path}")
    net = ShanghaiNet(state_size=STATE_SIZE)
    net.load_state_dict(torch.load(model_path, weights_only=True))
    net.eval()

    # Export to ONNX
    dummy_input = torch.randn(1, STATE_SIZE)
    onnx_path = MODELS_DIR / "shanghai_oracle.onnx"

    torch.onnx.export(
        net,
        dummy_input,
        str(onnx_path),
        input_names=["state"],
        output_names=["policy", "value"],
        dynamic_axes={
            "state": {0: "batch"},
            "policy": {0: "batch"},
            "value": {0: "batch"},
        },
        opset_version=17,
    )
    print(f"ONNX model saved to {onnx_path}")

    # Copy to public/models for the web app
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    public_path = PUBLIC_DIR / "shanghai_oracle.onnx"
    shutil.copy2(onnx_path, public_path)
    print(f"Copied to {public_path} (ready for web app)")

    # Print model info
    param_count = sum(p.numel() for p in net.parameters())
    file_size = onnx_path.stat().st_size / 1024
    print(f"\nModel info:")
    print(f"  Parameters: {param_count:,}")
    print(f"  File size: {file_size:.1f} KB")
    print(f"  Input: {STATE_SIZE} features")
    print(f"  Output: {MAX_ACTIONS} policy logits + 1 value")


if __name__ == "__main__":
    export()
