"""Smoke tests for v3 LSTM sequence model components."""
import pytest


def test_v3_input_dimensions():
    from state_encoder import (
        V3_HAND_FEATURES, V3_DISCARD_HISTORY_FEATURES,
        V3_TABLE_MELD_FEATURES, V3_GAME_CONTEXT_FEATURES,
        V3_MELD_PLAN_FEATURES, V3_OPP_EMBEDDING_TOTAL,
        V3_ACTION_TAKEN_FEATURES, V3_OPP_ACTIONS_FEATURES,
        V3_PHASE_FEATURES, V3_TIMESTEP_INPUT_SIZE,
    )
    expected = (
        V3_HAND_FEATURES
        + V3_DISCARD_HISTORY_FEATURES
        + V3_TABLE_MELD_FEATURES
        + V3_GAME_CONTEXT_FEATURES
        + V3_MELD_PLAN_FEATURES
        + V3_OPP_EMBEDDING_TOTAL
        + V3_ACTION_TAKEN_FEATURES
        + V3_OPP_ACTIONS_FEATURES
        + V3_PHASE_FEATURES
    )
    assert V3_TIMESTEP_INPUT_SIZE == expected
    assert V3_TIMESTEP_INPUT_SIZE == 373


def test_v3_constants_match_spec():
    from state_encoder import (
        V3_MELD_PLAN_FEATURES, V3_OPP_ACTIONS_FEATURES,
        V3_ACTION_TAKEN_FEATURES, V3_PHASE_FEATURES,
        V3_MAX_SEQ_LEN, V3_LSTM_HIDDEN,
    )
    assert V3_MELD_PLAN_FEATURES == 30
    assert V3_OPP_ACTIONS_FEATURES == 18
    assert V3_ACTION_TAKEN_FEATURES == 10
    assert V3_PHASE_FEATURES == 3
    assert V3_MAX_SEQ_LEN == 80
    assert V3_LSTM_HIDDEN == 192


import torch


def test_opponent_encoder_v3_shape():
    from network_v3 import OpponentEncoderNetV3
    from state_encoder import OPP_RAW_FEATURES, OPP_EMBEDDING_DIM
    encoder = OpponentEncoderNetV3()
    x = torch.randn(4, OPP_RAW_FEATURES)
    out = encoder(x)
    assert out.shape == (4, OPP_EMBEDDING_DIM)


def test_lstm_backbone_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, V3_MAX_SEQ_LEN
    model = ShanghaiLSTM()
    batch = 4
    seq_len = 35
    x = torch.randn(batch, seq_len, V3_TIMESTEP_INPUT_SIZE)
    mask = torch.ones(batch, seq_len, dtype=torch.bool)
    h_out, (h_n, c_n) = model.lstm_forward(x, mask)
    assert h_out.shape == (batch, seq_len, V3_LSTM_HIDDEN)
    assert h_n.shape == (2, batch, V3_LSTM_HIDDEN)
    assert c_n.shape == (2, batch, V3_LSTM_HIDDEN)


def test_draw_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    h_t = torch.randn(4, V3_LSTM_HIDDEN)
    offered = torch.randn(4, CARD_FEATURES)
    prob = model.draw_head_forward(h_t, offered)
    assert prob.shape == (4, 1)
    assert (prob >= 0).all() and (prob <= 1).all()


def test_discard_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_DISCARD_HEAD_OUTPUT
    model = ShanghaiLSTM()
    h_t = torch.randn(4, 192)
    logits = model.discard_head_forward(h_t)
    assert logits.shape == (4, V3_DISCARD_HEAD_OUTPUT)


def test_buy_head_shape():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    h_t = torch.randn(4, V3_LSTM_HIDDEN)
    offered = torch.randn(4, CARD_FEATURES)
    prob = model.buy_head_forward(h_t, offered)
    assert prob.shape == (4, 1)
    assert (prob >= 0).all() and (prob <= 1).all()


def test_auxiliary_head_shape():
    from network_v3 import ShanghaiLSTM
    model = ShanghaiLSTM()
    h_t = torch.randn(4, 192)
    score = model.auxiliary_head_forward(h_t)
    assert score.shape == (4, 1)


def test_full_forward_pass():
    from network_v3 import ShanghaiLSTM
    from state_encoder import V3_TIMESTEP_INPUT_SIZE, V3_LSTM_HIDDEN, CARD_FEATURES
    model = ShanghaiLSTM()
    batch, seq_len = 4, 35
    x = torch.randn(batch, seq_len, V3_TIMESTEP_INPUT_SIZE)
    mask = torch.ones(batch, seq_len, dtype=torch.bool)
    h_all, (h_n, c_n) = model.lstm_forward(x, mask)
    h_t = h_all[:, 10, :]
    offered = torch.randn(batch, CARD_FEATURES)
    draw_prob = model.draw_head_forward(h_t, offered)
    discard_logits = model.discard_head_forward(h_t)
    buy_prob = model.buy_head_forward(h_t, offered)
    aux_score = model.auxiliary_head_forward(h_n[-1])
    assert draw_prob.shape == (batch, 1)
    assert discard_logits.shape == (batch, 22)
    assert buy_prob.shape == (batch, 1)
    assert aux_score.shape == (batch, 1)
