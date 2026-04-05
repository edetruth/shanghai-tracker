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
