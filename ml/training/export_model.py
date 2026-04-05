"""
Export trained PyTorch model to ONNX format for browser inference.

Usage:
    python export_model.py            # export original policy model
    python export_model.py --v3       # export V3 LSTM model with explicit LSTM state I/O

Reads (default):  ml/models/shanghai_policy_best.pt (or shanghai_policy.pt)
Writes (default): ml/models/shanghai_oracle.onnx
                  public/models/shanghai_oracle.onnx (for the web app)

Reads (--v3):  ml/models/shanghai_lstm.pt
               ml/models/opponent_encoder_v3.pt
Writes (--v3): ml/models/shanghai_lstm_v3.onnx

The V3 ONNX graph takes:
  - x_t:          (1, 373) single-timestep LSTM input (already encoded)
  - offered_card: (1, 6)   card features for draw/buy heads
  - h_in:         (2, 1, 192) LSTM hidden state
  - c_in:         (2, 1, 192) LSTM cell state
And returns: draw_prob, discard_logits, buy_prob, h_out, c_out
"""

import argparse
import shutil
from pathlib import Path

import torch
import torch.nn as nn

from log_utils import setup_logging
from network import ShanghaiNet, STATE_SIZE, MAX_ACTIONS
from network_v3 import ShanghaiLSTM, OpponentEncoderNetV3
from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_LSTM_LAYERS, CARD_FEATURES

MODELS_DIR = Path(__file__).parent.parent / "models"
PUBLIC_DIR = Path(__file__).parent.parent.parent / "public" / "models"


class LSTMInferenceWrapper(nn.Module):
    """Wraps ShanghaiLSTM for single-step ONNX export with explicit LSTM state I/O."""

    def __init__(self, lstm_model: ShanghaiLSTM, opp_encoder: OpponentEncoderNetV3):
        super().__init__()
        self.model = lstm_model
        self.encoder = opp_encoder

    def forward(
        self,
        x_t: torch.Tensor,          # (1, 373)
        offered_card: torch.Tensor,  # (1, 6)
        h_in: torch.Tensor,          # (2, 1, 192)
        c_in: torch.Tensor,          # (2, 1, 192)
    ):
        out, (h_out, c_out) = self.model.lstm(x_t.unsqueeze(1), (h_in, c_in))
        h_t = out.squeeze(1)
        draw_prob = self.model.draw_head_forward(h_t, offered_card)
        discard_logits = self.model.discard_head_forward(h_t)
        buy_prob = self.model.buy_head_forward(h_t, offered_card)
        return draw_prob, discard_logits, buy_prob, h_out, c_out


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


def export_v3():
    """Export V3 LSTM model with explicit LSTM state I/O as a single ONNX graph."""
    lstm_path = MODELS_DIR / "shanghai_lstm.pt"
    encoder_path = MODELS_DIR / "opponent_encoder_v3.pt"

    if not lstm_path.exists():
        print(f"No V3 LSTM model found at {lstm_path}")
        print("Train V3 model first: python train_lstm_v3.py")
        return

    if not encoder_path.exists():
        print(f"No opponent encoder found at {encoder_path}")
        print("Train V3 model first: python train_lstm_v3.py")
        return

    print(f"Loading LSTM model from {lstm_path}")
    lstm_model = ShanghaiLSTM()
    lstm_model.load_state_dict(torch.load(lstm_path, weights_only=True))
    lstm_model.eval()

    print(f"Loading opponent encoder from {encoder_path}")
    opp_encoder = OpponentEncoderNetV3()
    opp_encoder.load_state_dict(torch.load(encoder_path, weights_only=True))
    opp_encoder.eval()

    # Build inference wrapper
    wrapper = LSTMInferenceWrapper(lstm_model, opp_encoder)
    wrapper.eval()

    # Dummy inputs matching the ONNX interface
    dummy_x_t = torch.randn(1, V3_TIMESTEP_INPUT_SIZE)          # (1, 373)
    dummy_offered = torch.randn(1, CARD_FEATURES)                 # (1, 6)
    dummy_h = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN)     # (2, 1, 192)
    dummy_c = torch.zeros(V3_LSTM_LAYERS, 1, V3_LSTM_HIDDEN)     # (2, 1, 192)

    onnx_path = MODELS_DIR / "shanghai_lstm_v3.onnx"

    print(f"Exporting to {onnx_path} (opset 17)...")
    torch.onnx.export(
        wrapper,
        (dummy_x_t, dummy_offered, dummy_h, dummy_c),
        str(onnx_path),
        input_names=["x_t", "offered_card", "h_in", "c_in"],
        output_names=["draw_prob", "discard_logits", "buy_prob", "h_out", "c_out"],
        dynamic_axes={
            "x_t":           {0: "batch"},
            "offered_card":  {0: "batch"},
            "h_in":          {1: "batch"},
            "c_in":          {1: "batch"},
            "draw_prob":     {0: "batch"},
            "discard_logits":{0: "batch"},
            "buy_prob":      {0: "batch"},
            "h_out":         {1: "batch"},
            "c_out":         {1: "batch"},
        },
        opset_version=17,
    )
    print(f"ONNX model saved to {onnx_path}")

    # Report sizes
    lstm_params = sum(p.numel() for p in lstm_model.parameters())
    enc_params = sum(p.numel() for p in opp_encoder.parameters())
    file_size_kb = onnx_path.stat().st_size / 1024

    print(f"\nModel info:")
    print(f"  LSTM parameters:     {lstm_params:,}")
    print(f"  Encoder parameters:  {enc_params:,}")
    print(f"  Total parameters:    {lstm_params + enc_params:,}")
    print(f"  ONNX file size:      {file_size_kb:.1f} KB")
    print(f"\nInputs:")
    print(f"  x_t:          (1, {V3_TIMESTEP_INPUT_SIZE}) — single-step LSTM input")
    print(f"  offered_card: (1, {CARD_FEATURES}) — card features")
    print(f"  h_in:         ({V3_LSTM_LAYERS}, 1, {V3_LSTM_HIDDEN}) — LSTM hidden state")
    print(f"  c_in:         ({V3_LSTM_LAYERS}, 1, {V3_LSTM_HIDDEN}) — LSTM cell state")
    print(f"\nOutputs: draw_prob, discard_logits, buy_prob, h_out, c_out")


if __name__ == "__main__":
    setup_logging("export_model")

    parser = argparse.ArgumentParser(description="Export Shanghai model to ONNX")
    parser.add_argument(
        "--v3",
        action="store_true",
        help="Export V3 LSTM model with explicit LSTM state I/O",
    )
    args = parser.parse_args()

    if args.v3:
        export_v3()
    else:
        export()
