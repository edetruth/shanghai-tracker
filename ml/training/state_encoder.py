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
