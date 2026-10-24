#!/usr/bin/env python3
"""Requirements traceability for the RB-01 certified core.

Reads the requirements under requirements/ and the `Covers:` tags in the test
suites, and reports the trace both ways. See
docs/certification/standards/requirements.md for the format this enforces and
requirements/README.md for how to use it.

    scripts/trace.py            the matrix, the errors and the untraced report
    scripts/trace.py --matrix   just the matrix, as Markdown
    scripts/trace.py --check    exit non-zero on a hard error (make check runs this)
    scripts/trace.py --budget   rewrite requirements/untraced.txt from the tree

Hard errors fail the build: a tag naming an identifier that does not exist, a
duplicate identifier, a malformed requirement block, a parent that does not
exist. A requirement with no test is *not* a hard error - it is held to the
budget in requirements/untraced.txt, which may only shrink.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REQ_DIR = os.path.join(ROOT, "requirements")
BUDGET = os.path.join(REQ_DIR, "untraced.txt")
FHA = os.path.join(ROOT, "docs", "certification", "fha.md")

# Where tests live. Each entry is (directory, filename pattern, test-definition regex).
TEST_TREES = [
    (ROOT, re.compile(r".*_test\.go$"), re.compile(r"^func (Test\w+)\(")),
    (os.path.join(ROOT, "test", "display"), re.compile(r"^test_.*\.py$"),
     re.compile(r"^\s*def (test_\w+|\w*check\w*)\(")),
    (os.path.join(ROOT, "test", "integration"), re.compile(r"^test_.*\.py$"),
     re.compile(r"^\s*def (test_\w+)\(")),
]
SKIP_DIRS = {".git", "vendor", "dump1090", "rtl-ais", "image_build", "image_build_rb",
             "node_modules", "__pycache__", "web"}

ID_RE = re.compile(r"RB-(?:SYS|HLR|ICD)-[A-Z]{3}-\d{3}")
HEADING_RE = re.compile(r"^###\s+(" + ID_RE.pattern + r")\s+[—-]\s+(.+?)\s*$")
FIELD_RE = re.compile(r"^-\s+\*\*(\w+):\*\*\s*(.+?)\s*$")
COVERS_RE = re.compile(r"(?://|#)\s*Covers:\s*(.+?)\s*$")

REQUIRED_FIELDS = ("Parent", "Source", "Verification", "Derived")
VERIFICATION_METHODS = ("test", "analysis", "review", "inspection")


class Req:
    def __init__(self, rid, title, path, line):
        self.id, self.title, self.path, self.line = rid, title, path, line
        self.fields = {}
        self.tests = []
        self.children = []

    @property
    def derived(self):
        return self.fields.get("Derived", "").lower().startswith("y")

    @property
    def withdrawn(self):
        return self.fields.get("Status", "").lower() == "withdrawn"

    @property
    def planned(self):
        return self.fields.get("Status", "").lower() == "planned"

    @property
    def by_test(self):
        return self.fields.get("Verification", "").lower() == "test"

    @property
    def is_system(self):
        return self.id.startswith("RB-SYS-")

    def coverage(self):
        """(covered, total) for this requirement.

        An HLR is covered by a test tagged with its identifier. A system
        requirement is not tested directly - it is satisfied through the HLRs
        that flow down from it, so its coverage is its children's.
        """
        if not self.is_system:
            return (1 if self.tests else 0), 1
        kids = [k for k in self.children if k.by_test and not k.withdrawn]
        if not kids:
            return 0, 0
        return sum(1 for k in kids if k.tests), len(kids)


def rel(path):
    return os.path.relpath(path, ROOT)


def parse_requirements(errors):
    reqs, seen = {}, {}
    if not os.path.isdir(REQ_DIR):
        errors.append(f"no requirements directory at {rel(REQ_DIR)}")
        return reqs
    for name in sorted(os.listdir(REQ_DIR)):
        if not name.endswith(".md") or name == "README.md":
            continue
        path = os.path.join(REQ_DIR, name)
        current = None
        for n, line in enumerate(open(path), 1):
            m = HEADING_RE.match(line)
            if m:
                rid, title = m.group(1), m.group(2)
                if rid in seen:
                    errors.append(f"{rel(path)}:{n}: duplicate identifier {rid}, "
                                  f"first defined at {seen[rid]}")
                seen[rid] = f"{rel(path)}:{n}"
                current = Req(rid, title, path, n)
                reqs[rid] = current
                continue
            if current is None:
                continue
            if line.startswith("### ") or line.startswith("## "):
                current = None
                continue
            f = FIELD_RE.match(line)
            if f and f.group(1) in REQUIRED_FIELDS + ("Status",):
                current.fields[f.group(1)] = f.group(2).strip()
    return reqs


def check_requirements(reqs, errors):
    for r in sorted(reqs.values(), key=lambda r: r.id):
        where = f"{rel(r.path)}:{r.line}"
        if r.withdrawn:
            continue
        for field in REQUIRED_FIELDS:
            if field not in r.fields:
                errors.append(f"{where}: {r.id} has no **{field}:** field")
        parent = r.fields.get("Parent", "").strip()
        parent_ids = ID_RE.findall(parent)
        if r.derived:
            if parent_ids:
                errors.append(f"{where}: {r.id} is derived but names a parent "
                              f"({', '.join(parent_ids)})")
        else:
            if not parent_ids:
                errors.append(f"{where}: {r.id} is not derived and names no parent "
                              f"(use 'Derived: yes' for a design decision)")
            for p in parent_ids:
                if p not in reqs:
                    errors.append(f"{where}: {r.id} names parent {p}, which does not exist")
        for p in parent_ids:
            if p in reqs and r not in reqs[p].children:
                reqs[p].children.append(r)
        method = r.fields.get("Verification", "").lower()
        if method and method not in VERIFICATION_METHODS:
            errors.append(f"{where}: {r.id} has verification method '{method}'; "
                          f"expected one of {', '.join(VERIFICATION_METHODS)}")


def iter_test_files():
    for base, name_re, def_re in TEST_TREES:
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for fn in sorted(filenames):
                if name_re.match(fn) or name_re.match(os.path.join(dirpath, fn)):
                    yield os.path.join(dirpath, fn), def_re


def parse_tests(reqs, errors):
    """Bind each `Covers:` tag to the next test definition below it."""
    tagged = 0
    for path, def_re in iter_test_files():
        pending, pending_line = [], 0
        for n, line in enumerate(open(path, errors="replace"), 1):
            c = COVERS_RE.search(line)
            if c:
                ids = ID_RE.findall(c.group(1))
                stray = [tok for tok in re.split(r"[,\s]+", c.group(1).strip())
                         if tok and not ID_RE.fullmatch(tok)]
                if stray:
                    errors.append(f"{rel(path)}:{n}: Covers: tag has unparsable "
                                  f"identifier(s): {' '.join(stray)}")
                pending.extend(ids)
                pending_line = n
                continue
            d = def_re.match(line)
            if d and pending:
                for rid in pending:
                    if rid not in reqs:
                        errors.append(f"{rel(path)}:{pending_line}: {d.group(1)} covers "
                                      f"{rid}, which is not a requirement")
                    else:
                        reqs[rid].tests.append(f"{rel(path)}:{d.group(1)}")
                        tagged += 1
                pending, pending_line = [], 0
        if pending:
            errors.append(f"{rel(path)}:{pending_line}: Covers: tag is not followed by a "
                          f"test definition")
    return tagged


def check_derived_in_fha(reqs, warnings):
    if not os.path.isfile(FHA):
        warnings.append(f"no FHA at {rel(FHA)}: derived requirements cannot be checked")
        return
    text = open(FHA).read()
    missing = [r.id for r in sorted(reqs.values(), key=lambda r: r.id)
               if r.derived and not r.withdrawn and r.id not in text]
    if missing:
        warnings.append(
            "derived requirements not mentioned in the FHA (the requirements standard "
            "§6 asks for each to be fed back to the safety assessment):\n    "
            + "\n    ".join(missing))


def untraced(reqs):
    """Requirements verifiable by test that no test covers."""
    return [r for r in sorted(reqs.values(), key=lambda r: r.id)
            if r.by_test and not r.withdrawn and not r.is_system and not r.tests]


def childless(reqs):
    """System requirements with no HLR flowing down from them."""
    return [r for r in sorted(reqs.values(), key=lambda r: r.id)
            if r.is_system and r.by_test and not r.withdrawn and r.coverage() == (0, 0)]


def read_budget():
    if not os.path.isfile(BUDGET):
        return None
    ids = set()
    for line in open(BUDGET):
        line = line.split("#", 1)[0].strip()
        if line:
            ids.add(line)
    return ids


def write_budget(reqs):
    ids = [r.id for r in untraced(reqs)]
    with open(BUDGET, "w") as fh:
        fh.write("# Requirements that are specified but have no test yet.\n"
                 "# Verification method is 'test', so each one is a real gap.\n"
                 "#\n"
                 "# scripts/trace.py --check fails if a requirement not listed here has no\n"
                 "# test, so the list may only shrink. Delete the line when you write the\n"
                 "# test; never add a line to make the build pass without agreeing it.\n"
                 "# Regenerate with: scripts/trace.py --budget\n")
        for rid in ids:
            fh.write(rid + "\n")
    return ids


def matrix(reqs):
    out = ["| Requirement | Title | Parent | Verified by |", "|---|---|---|---|"]
    for r in sorted(reqs.values(), key=lambda r: r.id):
        if r.withdrawn:
            continue
        if r.is_system:
            got, total = r.coverage()
            if total:
                v = f"{got}/{total} HLRs covered"
            elif not r.by_test:
                v = f"_{r.fields.get('Verification', '?')}_"
            else:
                v = "**no HLR flows down**"
        elif r.tests:
            v = "<br>".join(f"`{t}`" for t in r.tests)
        elif not r.by_test:
            v = f"_{r.fields.get('Verification', '?')}_"
        else:
            v = "**none**"
        out.append(f"| `{r.id}` | {r.title} | {r.fields.get('Parent', '?')} | {v} |")
    return "\n".join(out)


def main(argv):
    mode = argv[0] if argv else ""
    errors, warnings = [], []

    reqs = parse_requirements(errors)
    check_requirements(reqs, errors)
    tagged = parse_tests(reqs, errors)
    check_derived_in_fha(reqs, warnings)

    if mode == "--matrix":
        print(matrix(reqs))
        return 0

    if mode == "--budget":
        ids = write_budget(reqs)
        print(f"trace: wrote {len(ids)} untraced requirement(s) to {rel(BUDGET)}")
        return 0

    gaps = untraced(reqs)
    budget = read_budget()
    unbudgeted = [r for r in gaps if budget is not None and r.id not in budget]
    closed = sorted(budget - {r.id for r in gaps}) if budget else []

    active = [r for r in reqs.values() if not r.withdrawn]
    by_test = [r for r in active if r.by_test and not r.is_system]
    covered = [r for r in by_test if r.tests]
    orphans = childless(reqs)

    if mode != "--check":
        print(matrix(reqs))
        print()

    print(f"trace: {len(active)} requirements, {len(covered)}/{len(by_test)} HLRs "
          f"verifiable by test are covered, {tagged} tag(s) bound")

    if gaps:
        print(f"\nUNTRACED ({len(gaps)}) - specified, no test yet:")
        for r in gaps:
            flag = "  <-- NOT IN BUDGET" if r in unbudgeted else ""
            print(f"  {r.id}  {r.title}{flag}")
    if orphans:
        print(f"\nNO FLOW-DOWN ({len(orphans)}) - system requirements with no HLR "
              f"beneath them:")
        for r in orphans:
            print(f"  {r.id}  {r.title}")
    if closed:
        print(f"\nCLOSED since the budget was written ({len(closed)}) - "
              f"run scripts/trace.py --budget to drop them:")
        for rid in closed:
            print(f"  {rid}")
    for w in warnings:
        print(f"\nNOTE: {w}")

    if errors:
        print(f"\nERRORS ({len(errors)}):", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
    if unbudgeted:
        print(f"\nERRORS ({len(unbudgeted)}): requirement(s) with no test and no budget "
              f"entry:", file=sys.stderr)
        for r in unbudgeted:
            print(f"  {r.id} ({rel(r.path)}:{r.line})", file=sys.stderr)

    return 1 if (errors or unbudgeted) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
