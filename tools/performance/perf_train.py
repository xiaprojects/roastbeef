#!/usr/bin/env python3
# This file is part of RB.
#
# Copyright (C) 2026 XIAPROJECTS SRL
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, version 3.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.
"""perf_train.py: trains web/RB-01/settings/performance.json from recorded flights.

    python3 tools/performance/perf_train.py \\
        --aircraft I-RVDX \\
        --out web/RB-01/settings/performance.json \\
        test-data/flightlog-20261017161040.0001.sqlite \\
        test-data/flightlog-20261025101548.0171.sqlite \\
        --evaluate test-data/flightlog-20261025133703.0927.sqlite

1. perf_extract.py turns each log into samples.
2. perfrun.js runs them through web/RB-01/js/perfengine.js (the HMI's own code)
   and returns its steady segments: level and climb.
3. Least squares (numpy) fits each indicator's linear model on the segments:
       cruise    tasKt       ~ rpm + vsFpm (+ mapInHg when logged)
       attitude  aoaPitchDeg ~ invEas2
       climb     vsFpm       ~ rpm + iasKt + densityAltFt
       engine    rpm         ~ iasKt + densityAltFt
       fuel      75th percentile and spread of EGT spread, RPM and fuel pressure jitter
   A model with too few segments for its features drops features from the end;
   with none left the indicator stays UNTRAINED.
4. --evaluate runs the result over other flights (logs not used for the fit)
   and prints the KPI medians: about 100 on a normal flight.

Keys of --base (or the current --out) that are not models are kept: labels,
weights, bands, detector thresholds, referenceMassKg, aoaRefDeg...
docs/performance/training-from-sqlite.md explains every step.
"""

import argparse
import datetime
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import perf_extract  # noqa: E402

PERFRUN = os.path.join(HERE, "perfrun.js")

DEFAULT_CONFIG = {
    "version": 1,
    "aircraft": "",
    "notes": "",
    "detector": {
        "samplePeriodS": 1, "windowS": 20, "minSpeedKt": 50, "maxRollDeg": 8, "maxGDev": 0.15,
        "maxSpeedStdKt": 3, "maxRpmTrend": 50, "levelVsFpm": 150, "maxVsStdFpm": 250,
        "climbVsFpm": 300, "climbMinRpm": 0, "climbMinMapInHg": 0, "emsStaleS": 5,
    },
    "display": {
        "scaleMin": 50, "scaleMax": 130, "fadeS": 300, "holdS": 1800, "smoothing": 0.5,
        "bands": [
            {"color": "red", "min": 0, "max": 70},
            {"color": "yellow", "min": 70, "max": 90},
            {"color": "green", "min": 90, "max": 200},
        ],
    },
    "overall": {"enabled": True, "label": "OVERALL", "minIndicators": 2},
    "indicators": [
        {"id": "cruise", "label": "CRUISE", "algorithm": "rb-open", "weight": 1},
        {"id": "attitude", "label": "ATTITUDE", "algorithm": "rb-open", "weight": 1,
         "aoaRefDeg": 4, "minAoaDeg": 2.5, "smoothing": 0.2},
        {"id": "climb", "label": "CLIMB", "algorithm": "rb-open", "weight": 1, "smoothing": 0.3},
        {"id": "engine", "label": "ENGINE", "algorithm": "rb-open", "weight": 1},
        {"id": "fuel", "label": "FUEL", "algorithm": "rb-open", "weight": 1},
        {"id": "density", "label": "DENSITY", "algorithm": "rb-open", "weight": 0.5},
        {"id": "icing", "label": "ICING", "algorithm": "rb-open", "weight": 1, "carbWeight": 1},
    ],
}

# indicator -> (phase, target, features in order of importance)
MODELS = {
    "cruise": ("level", "tasKt", ["rpm", "vsFpm", "mapInHg"]),
    "attitude": ("level", "aoaPitchDeg", ["invEas2"]),
    "climb": ("climb", "vsFpm", ["rpm", "iasKt", "densityAltFt"]),
    "engine": ("climb", "rpm", ["iasKt", "densityAltFt"]),
}
SEGMENTS_PER_PARAMETER = 4


def run_segments(paths, config):
    """The steady segments perfengine.js finds in the logs."""
    cfg_path = os.path.join(os.environ.get("TMPDIR", "/tmp"), "perf_train_%d.json" % os.getpid())
    with open(cfg_path, "w") as f:
        json.dump(config, f)
    segs = []
    try:
        for p in paths:
            proc = subprocess.Popen(["node", PERFRUN, "segments", cfg_path],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            lines = (json.dumps(s, separators=(",", ":")) + "\n" for s in perf_extract.samples(p))
            out, _ = proc.communicate("".join(lines))
            n0 = len(segs)
            for line in out.splitlines():
                if line.strip():
                    s = json.loads(line)
                    s["log"] = os.path.basename(p)
                    segs.append(s)
            print("  %s: %d segments" % (os.path.basename(p), len(segs) - n0), file=sys.stderr)
    finally:
        os.unlink(cfg_path)
    return segs


def run_kpis(path, config):
    cfg_path = os.path.join(os.environ.get("TMPDIR", "/tmp"), "perf_eval_%d.json" % os.getpid())
    with open(cfg_path, "w") as f:
        json.dump(config, f)
    try:
        proc = subprocess.Popen(["node", PERFRUN, "kpis", cfg_path, "--every", "30"],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        lines = (json.dumps(s, separators=(",", ":")) + "\n" for s in perf_extract.samples(path))
        out, _ = proc.communicate("".join(lines))
    finally:
        os.unlink(cfg_path)
    rows = [json.loads(l) for l in out.splitlines() if l.strip()]
    return rows[-1] if rows and rows[-1].get("summary") else {}


def usable(seg, keys):
    return all(isinstance(seg.get(k), (int, float)) for k in keys)


def fit_linear(segs, target, features):
    """Least squares with as many features as the segments support."""
    feats = list(features)
    while True:
        rows = [s for s in segs if usable(s, [target] + feats)]
        if len(rows) >= SEGMENTS_PER_PARAMETER * (len(feats) + 1):
            # a feature that never varies cannot be fitted
            spread_ok = all(np.ptp([s[f] for s in rows]) > 1e-6 for f in feats)
            if spread_ok:
                break
        if not feats:
            return None
        feats.pop()
    # Least squares, then once more without the segments more than 3 robust sigmas off:
    # a flapped approach or a misread probe must not bend the model
    outliers = 0
    for _ in range(2):
        X = np.array([[1.0] + [s[f] for f in feats] for s in rows])
        y = np.array([s[target] for s in rows])
        coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        resid = y - X @ coef
        scale = 1.4826 * np.median(np.abs(resid - np.median(resid)))
        keep = np.abs(resid) <= 3 * max(scale, 1e-9)
        if keep.all() or keep.sum() < SEGMENTS_PER_PARAMETER * (len(feats) + 1):
            break
        outliers += int((~keep).sum())
        rows = [r for r, k in zip(rows, keep) if k]
    pred = X @ coef
    rmse = float(np.sqrt(np.mean((y - pred) ** 2)))
    ss = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - float(np.sum((y - pred) ** 2)) / ss if ss > 0 else 0.0
    return {
        "target": target,
        "features": feats,
        "intercept": round(float(coef[0]), 6),
        "coef": [round(float(c), 8) for c in coef[1:]],
        "range": {f: [round(float(min(s[f] for s in rows)), 4), round(float(max(s[f] for s in rows)), 4)] for f in feats},
        "rangeMargin": 0.15,
        "n": len(rows),
        "outliers": outliers,
        "rmse": round(rmse, 4),
        "r2": round(r2, 4),
        "meanTarget": round(float(y.mean()), 4),
    }


def fit_cruise(segs):
    m = fit_linear(segs, "tasKt", MODELS["cruise"][2])
    rows = [s for s in segs if usable(s, ["tasKt", "rpm"])]
    if (m is None or "rpm" not in m["features"]) and rows:
        # Too little RPM spread to fit: a fixed pitch propeller flies at a constant
        # advance ratio, TAS proportional to RPM
        tas, rpm = np.mean([s["tasKt"] for s in rows]), np.mean([s["rpm"] for s in rows])
        m = {"target": "tasKt", "features": ["rpm"], "intercept": 0.0, "coef": [round(float(tas / rpm), 8)],
             "range": {"rpm": [min(s["rpm"] for s in rows), max(s["rpm"] for s in rows)]},
             "rangeMargin": 0.15, "n": len(rows), "rmse": None, "r2": None, "prior": "tas-proportional-to-rpm",
             "meanTarget": round(float(tas), 4)}
    return m


def fit_attitude(segs, aoa_ref):
    m = fit_linear(segs, "aoaPitchDeg", ["invEas2"])
    rows = [s for s in segs if usable(s, ["aoaPitchDeg", "invEas2"])]
    if not rows:
        return None
    mean_inv = float(np.mean([s["invEas2"] for s in rows]))
    if m is None or not m["features"] or m["coef"][0] <= 0 or m["coef"][0] * mean_inv < 0.5:
        # The training could not separate the angle of attack from the mounting offset
        # (speeds too alike): assume the configured cruise AoA at the mean speed
        mean_pitch = float(np.mean([s["aoaPitchDeg"] for s in rows]))
        b = aoa_ref / mean_inv
        m = {"target": "aoaPitchDeg", "features": ["invEas2"], "intercept": round(mean_pitch - aoa_ref, 4),
             "coef": [round(b, 6)],
             "range": {"invEas2": [round(min(s["invEas2"] for s in rows), 4), round(max(s["invEas2"] for s in rows), 4)]},
             "rangeMargin": 0.5, "n": len(rows),
             "rmse": round(float(np.std([s["aoaPitchDeg"] for s in rows])), 4), "r2": None,
             "prior": "aoaRefDeg at the mean speed", "meanTarget": round(mean_pitch, 4)}
    return m


def spread_ref(values, min_tol):
    v = np.array([x for x in values if isinstance(x, (int, float))])
    if len(v) < 5:
        return None, None
    p25, p75 = np.percentile(v, [25, 75])
    return round(float(p75), 3), round(float(max(min_tol, 3 * (p75 - p25))), 3)


def train(segs, base, speed_source):
    cfg = json.loads(json.dumps(base))
    if speed_source:
        segs = [s for s in segs if s.get("speedSource") == speed_source]
    level = [s for s in segs if s["phase"] == "level"]
    climb = [s for s in segs if s["phase"] == "climb"]
    print("training on %d level and %d climb segments" % (len(level), len(climb)), file=sys.stderr)
    ind = {i["id"]: i for i in cfg["indicators"]}
    report = {}

    def put(kid, model):
        if kid not in ind:
            return
        if model is None:
            ind[kid].pop("model", None)
            report[kid] = "UNTRAINED (too few segments)"
        else:
            ind[kid]["model"] = model
            noise = ""
            if model.get("rmse") is not None and model.get("meanTarget"):
                noise = ", one segment ±%.1f %%" % (100 * model["rmse"] / abs(model["meanTarget"]))
            report[kid] = "%s ~ %s, n=%d (%d outliers left out), rmse=%s, r2=%s%s" % (
                model["target"], " + ".join(model["features"]) or "1", model["n"], model.get("outliers", 0),
                model["rmse"], model["r2"], noise)

    put("cruise", fit_cruise(level))
    put("attitude", fit_attitude(level, ind.get("attitude", {}).get("aoaRefDeg", 4)))
    put("climb", fit_linear(climb, "vsFpm", MODELS["climb"][2]))
    put("engine", fit_linear(climb, "rpm", MODELS["engine"][2]))
    if "fuel" in ind:
        f = ind["fuel"]
        steady = level + climb
        f["egtSpreadRefC"], f["egtSpreadTolC"] = spread_ref([s.get("egtSpreadC") for s in steady], 40)
        f["rpmJitterRef"], f["rpmJitterTol"] = spread_ref([s.get("rpmJitter") for s in steady], 30)
        f["fuelPressureJitterRef"], f["fuelPressureJitterTol"] = spread_ref([s.get("fuelPressureJitter") for s in steady], 1.0)
        for k in list(f):
            if f[k] is None:
                del f[k]
        report["fuel"] = "EGT spread ref %s tol %s, RPM jitter ref %s tol %s, fuel pressure %s" % (
            f.get("egtSpreadRefC"), f.get("egtSpreadTolC"), f.get("rpmJitterRef"), f.get("rpmJitterTol"),
            f.get("fuelPressureJitterRef", "not logged"))
    return cfg, report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("logs", nargs="*", help="flight logs to train on")
    ap.add_argument("--out", required=True, help="performance.json to write")
    ap.add_argument("--base", help="start from this performance.json (default: --out if it exists)")
    ap.add_argument("--aircraft", help="registration written into the file")
    ap.add_argument("--speed-source", choices=["IAS", "GS", "WIND"],
                    help="only segments with this airspeed source (default: the most common one)")
    ap.add_argument("--evaluate", nargs="*", default=[], help="flights to check the result on")
    ap.add_argument("--segments-out", help="also write the segments as JSON lines (for your own analysis)")
    a = ap.parse_args()

    base_path = a.base or (a.out if os.path.exists(a.out) else None)
    base = json.load(open(base_path)) if base_path else json.loads(json.dumps(DEFAULT_CONFIG))
    if a.aircraft:
        base["aircraft"] = a.aircraft

    if a.logs:
        print("extracting steady segments:", file=sys.stderr)
        segs = run_segments(a.logs, base)
        if a.segments_out:
            with open(a.segments_out, "w") as f:
                for s in segs:
                    f.write(json.dumps(s) + "\n")
        src = a.speed_source
        if not src and segs:
            counts = {}
            for s in segs:
                counts[s.get("speedSource")] = counts.get(s.get("speedSource"), 0) + 1
            src = max(counts, key=counts.get)
            if len(counts) > 1:
                print("speed sources %s: training on %s only" % (counts, src), file=sys.stderr)
        cfg, report = train(segs, base, src)
        cfg["trainedAt"] = datetime.date.today().isoformat()
        cfg["trainedFrom"] = [os.path.basename(p) for p in a.logs]
        cfg["trainedSpeedSource"] = src
        cfg["engineVersion"] = "1.0.0"
        for k, v in report.items():
            print("  %-9s %s" % (k, v), file=sys.stderr)
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w") as f:
            json.dump(cfg, f, indent=4, ensure_ascii=False)
            f.write("\n")
        print("wrote %s" % a.out, file=sys.stderr)
    else:
        cfg = base

    for p in a.evaluate:
        s = run_kpis(p, cfg)
        print("evaluate %s (%s segments):" % (os.path.basename(p), s.get("segments")), file=sys.stderr)
        for k, v in s.items():
            if isinstance(v, dict):
                print("  %-9s median %4s  (min %s, max %s, %d readings)" % (k, v["median"], v["min"], v["max"], v["n"]),
                      file=sys.stderr)


if __name__ == "__main__":
    main()
