import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # ml/pimc

import torch
import pytest

from alphazero.network import ShanghaiNet
from alphazero.export  import export_onnx, OUTPUT_NAMES, INPUT_NAME


def _net():
    return ShanghaiNet()


def test_export_creates_file():
    net = _net()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "test.onnx"
        export_onnx(net, str(out), verify=False)
        assert out.exists(), "ONNX file was not created"
        assert out.stat().st_size > 0


def test_export_output_names():
    """Output names must match what the web app's inference code expects."""
    assert OUTPUT_NAMES == [
        "discard_logits", "draw_logits", "buy_logit", "laydown_logit", "value"
    ]


def test_export_input_name():
    assert INPUT_NAME == "state"


def test_forward_onnx_shapes():
    """forward_onnx() must return tensors in the same order as OUTPUT_NAMES."""
    net = _net()
    x   = torch.zeros(1, 170)
    out = net.forward_onnx(x)
    assert isinstance(out, tuple)
    assert len(out) == 5
    assert out[0].shape == (1, 53)  # discard_logits
    assert out[1].shape == (1,  2)  # draw_logits
    assert out[2].shape == (1,  1)  # buy_logit
    assert out[3].shape == (1,  1)  # laydown_logit
    assert out[4].shape == (1,  1)  # value


def test_export_with_onnxruntime():
    """If onnxruntime is available, verify that inference matches PyTorch."""
    try:
        import onnxruntime  # noqa: F401
        import numpy as np
    except ImportError:
        pytest.skip("onnxruntime not installed")

    net = _net()
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "verify.onnx"
        export_onnx(net, str(out), verify=True)  # raises on mismatch
        assert out.exists()
