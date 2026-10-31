"""Bugs these tests found in code that predates them.

They are listed rather than silenced: the runs still print every one, so they
stay visible, but they do not fail the suite. That way a NEW regression is loud.

Delete an entry as soon as its bug is fixed - a stale entry here is worse than
no entry, because it hides a regression that happens to look similar.
"""

KNOWN = [
    {
        "test": "controls", "plate": "*", "match": "fabClick('NE'",
        "title": "NW/NE corner FABs sit underneath the navbar",
        "why": "See the NW entry - same cause, opposite corner.",
    },
    {
        "test": "controls", "plate": "*", "match": "fabClick('NW'",
        "title": "NW/NE corner FABs sit underneath the navbar",
        "why": (
            "On most plates the NW and NE floating action buttons are covered by "
            "DIV.navbar, so a touch at their centre never reaches them. "
            "js/main.js:371-377 only ever enables the N/S/E/W FABs, so these two "
            "corners may be leftovers - but as shipped they are dead touch "
            "targets. Confirm whether they are meant to be reachable."),
    },
    {
        "test": "controls", "plate": "timers", "match": "dropTimer",
        "title": "timers: the east FAB covers the delete icon of the right-hand timer",
        "why": (
            "With timers configured (the aircraft has four), the right column's "
            "panel headings sit at the same height as the east-edge fabNavigation "
            "caret in index.html, and its touch area extends over the trash icon "
            "(dropTimer) of Timer 2 - a tap there opens the sidebar instead of "
            "deleting the timer. Same family as the NW/NE FAB entries: the corner "
            "and edge FABs need a z-order or inset that keeps them off plate "
            "controls."),
    },
]


def lookup(test, plate, text):
    """Return the known issue matching this failure, or None if it is new."""
    for issue in KNOWN:
        if issue["test"] != test:
            continue
        if issue["plate"] not in ("*", plate):
            continue
        if issue["match"] in text:
            return issue
    return None


def report(found):
    """Print the known issues a run hit. `found` is a list of (issue, where)."""
    if not found:
        return
    seen = {}
    for issue, where in found:
        seen.setdefault(issue["title"], (issue, []))[1].append(where)
    print("\n  \033[33mKNOWN ISSUES (pre-existing, not failing the suite)\033[0m")
    for title, (issue, wheres) in seen.items():
        print("    - %s" % title)
        print("      seen on: %s" % ", ".join(sorted(set(wheres))))
        print("      %s" % issue["why"])
