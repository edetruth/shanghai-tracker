"""
Check what human play data exists in Supabase for training.
Queries game_action_log, ai_decisions, and player_round_stats
to see how much usable training data we have.
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load env from project root — use dotenv_values to avoid BOM issues
from dotenv import dotenv_values
env_path = Path(__file__).parent.parent.parent / ".env.local"
env_vars = dotenv_values(str(env_path))
# Strip BOM from keys
env_vars = {k.lstrip('\ufeff'): v for k, v in env_vars.items()}

url = env_vars["VITE_SUPABASE_URL"]
key = env_vars["VITE_SUPABASE_ANON_KEY"]
supabase = create_client(url, key)


def check_games():
    """Check how many games exist by type."""
    print("=== Games by Type ===")
    result = supabase.table("games").select("id, game_type, is_complete").execute()
    games = result.data
    print(f"Total games: {len(games)}")

    by_type = {}
    for g in games:
        t = g.get("game_type") or "null"
        by_type.setdefault(t, {"total": 0, "complete": 0})
        by_type[t]["total"] += 1
        if g.get("is_complete"):
            by_type[t]["complete"] += 1

    for t, counts in sorted(by_type.items()):
        print(f"  {t}: {counts['total']} total, {counts['complete']} complete")
    print()
    return games


def check_action_log():
    """Check game_action_log for recorded actions."""
    print("=== Action Log ===")
    # Get count and sample
    result = supabase.table("game_action_log").select("id", count="exact").limit(1).execute()
    total = result.count
    print(f"Total action log entries: {total}")

    if total and total > 0:
        # Get action type breakdown (sample first 5000)
        result = supabase.table("game_action_log").select("action_type, game_id").limit(5000).execute()
        actions = result.data
        by_type = {}
        game_ids = set()
        for a in actions:
            at = a.get("action_type", "unknown")
            by_type[at] = by_type.get(at, 0) + 1
            game_ids.add(a.get("game_id"))

        print(f"Games with action logs (in sample): {len(game_ids)}")
        print("Action types:")
        for at, count in sorted(by_type.items(), key=lambda x: -x[1]):
            print(f"  {at}: {count}")

        # Show a sample action
        sample = supabase.table("game_action_log").select("*").limit(3).execute()
        print("\nSample entries:")
        for s in sample.data:
            print(f"  seq={s.get('seq')} type={s.get('action_type')} data={json.dumps(s.get('action_data', {}))[:120]}")
    print()


def check_ai_decisions():
    """Check ai_decisions table for human vs AI decision data."""
    print("=== AI Decisions (includes human decisions) ===")
    result = supabase.table("ai_decisions").select("id", count="exact").limit(1).execute()
    total = result.count
    print(f"Total decision entries: {total}")

    if total and total > 0:
        # Check for is_human flag
        result = supabase.table("ai_decisions").select(
            "decision_type, decision_result, is_human, game_id"
        ).limit(5000).execute()
        decisions = result.data

        human_count = sum(1 for d in decisions if d.get("is_human"))
        ai_count = sum(1 for d in decisions if not d.get("is_human"))
        game_ids = set(d.get("game_id") for d in decisions)

        print(f"Games with decisions (in sample): {len(game_ids)}")
        print(f"Human decisions: {human_count}")
        print(f"AI decisions: {ai_count}")

        by_type = {}
        for d in decisions:
            dt = d.get("decision_type", "unknown")
            by_type[dt] = by_type.get(dt, 0) + 1
        print("Decision types:")
        for dt, count in sorted(by_type.items(), key=lambda x: -x[1]):
            print(f"  {dt}: {count}")

        # Sample a human decision if any
        if human_count > 0:
            human_sample = supabase.table("ai_decisions").select("*").eq("is_human", True).limit(2).execute()
            print("\nSample human decisions:")
            for s in human_sample.data:
                print(f"  type={s.get('decision_type')} result={s.get('decision_result')} "
                      f"card={s.get('card_suit')}{s.get('card_rank')} hand_size={s.get('hand_size')}")
    print()


def check_round_stats():
    """Check player_round_stats for human play patterns."""
    print("=== Player Round Stats ===")
    result = supabase.table("player_round_stats").select("id", count="exact").limit(1).execute()
    total = result.count
    print(f"Total round stat entries: {total}")

    if total and total > 0:
        result = supabase.table("player_round_stats").select(
            "player_name, is_human, round_score, went_out, went_down, game_id"
        ).limit(5000).execute()
        stats = result.data

        human_stats = [s for s in stats if s.get("is_human")]
        ai_stats = [s for s in stats if not s.get("is_human")]

        print(f"Human round entries: {len(human_stats)}")
        print(f"AI round entries: {len(ai_stats)}")

        if human_stats:
            scores = [s["round_score"] for s in human_stats if s.get("round_score") is not None]
            went_out = sum(1 for s in human_stats if s.get("went_out"))
            went_down = sum(1 for s in human_stats if s.get("went_down"))
            if scores:
                print(f"Human avg round score: {sum(scores)/len(scores):.1f}")
                print(f"Human went out: {went_out}/{len(human_stats)} ({100*went_out/len(human_stats):.1f}%)")
                print(f"Human went down: {went_down}/{len(human_stats)} ({100*went_down/len(human_stats):.1f}%)")

        if ai_stats:
            scores = [s["round_score"] for s in ai_stats if s.get("round_score") is not None]
            if scores:
                print(f"AI avg round score: {sum(scores)/len(scores):.1f}")

        # Unique players
        players = set(s.get("player_name") for s in human_stats)
        print(f"Unique human players: {players}")
    print()


def check_game_stats():
    """Check player_game_stats for overall performance."""
    print("=== Player Game Stats ===")
    result = supabase.table("player_game_stats").select("id", count="exact").limit(1).execute()
    total = result.count
    print(f"Total game stat entries: {total}")

    if total and total > 0:
        result = supabase.table("player_game_stats").select(
            "player_name, is_human, total_score, final_rank, won"
        ).limit(5000).execute()
        stats = result.data

        human_stats = [s for s in stats if s.get("is_human")]
        if human_stats:
            scores = [s["total_score"] for s in human_stats if s.get("total_score") is not None]
            wins = sum(1 for s in human_stats if s.get("won"))
            print(f"Human games: {len(human_stats)}")
            if scores:
                print(f"Human avg total score: {sum(scores)/len(scores):.1f}")
                print(f"Human win rate: {100*wins/len(human_stats):.1f}%")
    print()


if __name__ == "__main__":
    print("Shanghai Rummy — Human Play Data Check\n")
    check_games()
    check_action_log()
    check_ai_decisions()
    check_round_stats()
    check_game_stats()
    print("Done!")
