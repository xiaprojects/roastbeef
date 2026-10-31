#!/usr/bin/env python3
"""Run the RB-01 display tests.

    ./run.py                 # everything
    ./run.py synthview       # only test_synthview.py
    ./run.py -k              # keep going after a failing file

Needs nothing but Python 3 and a chrome/chromium on PATH.
"""

import glob
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def discover(patterns):
    files = sorted(glob.glob(os.path.join(HERE, "test_*.py")))
    if not patterns:
        return files
    return [f for f in files
            if any(p in os.path.basename(f) for p in patterns)]


def main(argv):
    keep_going = "-k" in argv
    patterns = [a for a in argv if not a.startswith("-")]
    files = discover(patterns)
    if not files:
        print("no test files match %s" % patterns)
        return 2

    results = []
    for path in files:
        name = os.path.basename(path)
        print("\n\033[1m=== %s ===\033[0m" % name)
        # -u: without it a child block-buffers when the runner is redirected to a
        # file or a CI log, so nothing appears until the whole file finishes.
        proc = subprocess.run([sys.executable, "-u", path], cwd=HERE)
        results.append((name, proc.returncode))
        if proc.returncode != 0 and not keep_going:
            break

    print("\n" + "=" * 52)
    for name, code in results:
        print("  %-28s %s" % (name, "ok" if code == 0 else "FAILED"))
    failed = [r for r in results if r[1] != 0]
    print("=" * 52)
    print("%d/%d files passed" % (len(results) - len(failed), len(results)))
    print("screenshots in %s" % os.path.join(HERE, "shots"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
