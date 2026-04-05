"""
State encoder — defines the rich state vector layout.
Must match the bridge's encodeRichState() output exactly.

V2: Base state (264) + opponent raw (378) returned separately.
     Opponent encoder produces 48-dim embedding.
     Enriched state = base (264) + embedding (48) = 312.
"""

# Card features: rank/13, suit_onehot(4), is_joker
CARD_FEATURES = 6
MAX_HAND_CARDS = 22
MAX_DISCARD_HISTORY = 10
MAX_TABLE_MELDS = 12
MELD_FEATURES = 5

# Game context WITHOUT opponent features (old 21 - 9 opponent = 12)
GAME_CONTEXT_FEATURES_V2 = 12  # round, requirements, pile sizes, buys, hand pts, turn, buy-window, own score, player count

# Base state (no opponent features) — returned by bridge as "state"
BASE_STATE_SIZE = (
    MAX_HAND_CARDS * CARD_FEATURES +      # 132: hand cards
    MAX_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    MAX_TABLE_MELDS * MELD_FEATURES +      # 60: table melds
    GAME_CONTEXT_FEATURES_V2              # 12: game context (no opponents)
)
# Total: 264

# Opponent raw features (returned by bridge as "opponent_raw")
MAX_OPPONENTS = 3
OPP_DISCARD_HISTORY = 10  # last 10 discards per opponent
OPP_PICKUP_HISTORY = 5    # last 5 pickups per opponent
OPP_MAX_MELDS = 6         # up to 6 melds per opponent
OPP_SCALAR_STATS = 6      # hand_size, laid_down, buys_remaining, cards_laid_off, cumulative_score, is_winning

OPP_RAW_FEATURES = (
    OPP_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    OPP_PICKUP_HISTORY * CARD_FEATURES +   # 30: pickup history
    OPP_MAX_MELDS * MELD_FEATURES +        # 30: meld composition
    OPP_SCALAR_STATS                       # 6: scalar stats
)
# Total per opponent: 126

OPP_RAW_TOTAL = MAX_OPPONENTS * OPP_RAW_FEATURES  # 378

# Opponent encoder output
OPP_EMBEDDING_DIM = 16
OPP_EMBEDDING_TOTAL = MAX_OPPONENTS * OPP_EMBEDDING_DIM  # 48

# Enriched state (base + opponent embeddings)
ENRICHED_STATE_SIZE = BASE_STATE_SIZE + OPP_EMBEDDING_TOTAL  # 312

# Legacy (keep for backward compatibility with v1 models)
RICH_STATE_SIZE = 273
GAME_CONTEXT_FEATURES = 21

# Offered card features (unchanged)
OFFERED_CARD_FEATURES = 6

# Action encoding (unchanged)
MAX_ACTIONS = 350
BUY_ACTION_IDX = 339
DECLINE_BUY_ACTION_IDX = 340

# ── V3: LSTM Sequence Model ──────────────────────────────────────────

# Per-timestep input components
V3_HAND_FEATURES = MAX_HAND_CARDS * CARD_FEATURES          # 22 * 6 = 132
V3_DISCARD_HISTORY_FEATURES = MAX_DISCARD_HISTORY * CARD_FEATURES  # 10 * 6 = 60
V3_TABLE_MELD_FEATURES = MAX_TABLE_MELDS * MELD_FEATURES   # 12 * 5 = 60
V3_GAME_CONTEXT_FEATURES = 12  # round, req_sets, req_runs, draw_pile, discard_pile,
                                # buys_remaining, hand_points, turn, buy_window,
                                # cumulative_score, player_count, laid_down

# New v3 feature groups
V3_MELD_PLAN_FEATURES = 30     # See spec: plan count, completeness, per-requirement, etc.
V3_OPP_ACTIONS_FEATURES = 18   # Opponent actions between our turns
V3_ACTION_TAKEN_FEATURES = 10  # Previous action: type one-hot(5) + card features(5)
V3_PHASE_FEATURES = 3          # One-hot: draw / buy / action

# Alias for v3 (reuses v2 opponent embedding)
V3_OPP_EMBEDDING_TOTAL = OPP_EMBEDDING_TOTAL  # 48 (3 opponents x 16-dim)

# Total per-timestep input to LSTM
V3_TIMESTEP_INPUT_SIZE = (
    V3_HAND_FEATURES
    + V3_DISCARD_HISTORY_FEATURES
    + V3_TABLE_MELD_FEATURES
    + V3_GAME_CONTEXT_FEATURES
    + V3_MELD_PLAN_FEATURES
    + OPP_EMBEDDING_TOTAL          # 48 (3 opponents x 16-dim, reused from v2)
    + V3_ACTION_TAKEN_FEATURES
    + V3_OPP_ACTIONS_FEATURES
    + V3_PHASE_FEATURES
)  # = 373

# LSTM architecture
V3_LSTM_HIDDEN = 192
V3_LSTM_LAYERS = 2
V3_LSTM_DROPOUT = 0.2
V3_MAX_SEQ_LEN = 80  # Max timesteps per round sequence (padded)

# Head input sizes
V3_DRAW_HEAD_INPUT = V3_LSTM_HIDDEN + CARD_FEATURES    # 192 + 6 = 198
V3_BUY_HEAD_INPUT = V3_LSTM_HIDDEN + CARD_FEATURES     # 192 + 6 = 198
V3_DISCARD_HEAD_INPUT = V3_LSTM_HIDDEN                  # 192
V3_DISCARD_HEAD_OUTPUT = MAX_HAND_CARDS                 # 22

# Phase indices for one-hot encoding
V3_PHASE_DRAW = 0
V3_PHASE_BUY = 1
V3_PHASE_ACTION = 2

# Action type indices for one-hot encoding (action_taken features)
V3_ACT_DRAW_PILE = 0
V3_ACT_TAKE_DISCARD = 1
V3_ACT_BUY = 2
V3_ACT_DECLINE_BUY = 3
V3_ACT_DISCARD = 4
