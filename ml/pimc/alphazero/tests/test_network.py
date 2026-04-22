import torch
import pytest
from pathlib import Path

PIMC_MODELS = Path(__file__).parent.parent.parent / "models"


def test_forward_output_shapes():
    from network import ShanghaiNet
    net = ShanghaiNet()
    x = torch.zeros(3, 170)
    out = net(x)
    assert out["discard_logits"].shape == (3, 53)
    assert out["draw_logits"].shape == (3, 2)
    assert out["buy_logit"].shape == (3, 1)
    assert out["laydown_logit"].shape == (3, 1)
    assert out["value"].shape == (3, 1)


def test_forward_onnx_output_shapes():
    from network import ShanghaiNet
    net = ShanghaiNet()
    x = torch.zeros(1, 170)
    out = net.forward_onnx(x)
    assert isinstance(out, tuple)
    assert len(out) == 5
    assert out[0].shape == (1, 53)   # discard
    assert out[1].shape == (1, 2)    # draw
    assert out[2].shape == (1, 1)    # buy
    assert out[3].shape == (1, 1)    # laydown
    assert out[4].shape == (1, 1)    # value


def test_warm_start_loads_backbone():
    """Backbone weights should differ from random init after loading v7."""
    from network import ShanghaiNet
    ckpt = PIMC_MODELS / "network_v7.pt"
    if not ckpt.exists():
        pytest.skip("network_v7.pt not found")

    fresh = ShanghaiNet()
    warm = ShanghaiNet.from_pimc_checkpoint(ckpt)

    # At least one backbone weight should differ from fresh random init
    for (fn, fp), (wn, wp) in zip(fresh.backbone.named_parameters(), warm.backbone.named_parameters()):
        if not torch.allclose(fp, wp):
            return  # found a difference — pass
    pytest.fail("Backbone weights identical to random init after warm-start")


def test_warm_start_new_heads_are_not_loaded():
    """draw/buy/laydown/value heads must NOT have weights loaded from PIMC checkpoint.

    PIMCDiscardNet has draw_head (1,256) — ShanghaiNet has draw_head (2,256).
    buy/laydown/value heads don't exist in PIMC at all.
    from_pimc_checkpoint() must leave all new heads randomly initialized.
    """
    from network import ShanghaiNet
    ckpt = PIMC_MODELS / "network_v7.pt"
    if not ckpt.exists():
        pytest.skip("network_v7.pt not found")

    pimc_state = torch.load(ckpt, map_location="cpu")
    warm = ShanghaiNet.from_pimc_checkpoint(ckpt)

    # draw_head shape must be (2, 256) — incompatible with PIMC's (1, 256)
    assert warm.draw_head.weight.shape == (2, 256), (
        f"draw_head should be (2,256), got {warm.draw_head.weight.shape}"
    )
    # Verify PIMC draw_head was NOT loaded: PIMC has shape (1,256), ShanghaiNet (2,256) — incompatible
    if "draw_head.weight" in pimc_state:
        pimc_draw_shape = pimc_state["draw_head.weight"].shape
        assert pimc_draw_shape != warm.draw_head.weight.shape, (
            "draw_head weight shapes match — PIMC weights may have been loaded!"
        )

    # buy/laydown/value heads must not exist in PIMC checkpoint
    for key in ("buy_head.weight", "laydown_head.weight", "value_head.weight"):
        assert key not in pimc_state, f"PIMC checkpoint unexpectedly contains {key}"
