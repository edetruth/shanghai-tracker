"""
State encoder — defines the rich state vector layout.
Must match the bridge's encodeRichState() output exactly.
"""

# Card features: rank/13, suit_onehot(4), is_joker
CARD_FEATURES = 6
MAX_HAND_CARDS = 22
MAX_DISCARD_HISTORY = 10
MAX_TABLE_MELDS = 12
MELD_FEATURES = 5
GAME_CONTEXT_FEATURES = 21  # round, requirements, pile sizes, buys, opponents, etc.

# Total state size (must match bridge output)
RICH_STATE_SIZE = (
    MAX_HAND_CARDS * CARD_FEATURES +      # 132: hand cards
    MAX_DISCARD_HISTORY * CARD_FEATURES +  # 60: discard history
    MAX_TABLE_MELDS * MELD_FEATURES +      # 60: table melds
    GAME_CONTEXT_FEATURES                  # 21: game context + opponents
)
# Total: 273

# Action encoding (unchanged from v1)
MAX_ACTIONS = 350
BUY_ACTION_IDX = 339
DECLINE_BUY_ACTION_IDX = 340
