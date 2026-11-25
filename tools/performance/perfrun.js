#!/usr/bin/env node
/*
 * This file is part of RB.
 *
 * Copyright (C) 2026 XIAPROJECTS SRL
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * perfrun.js: runs web/RB-01/js/perfengine.js, the code the HMI runs, over the
 * samples perf_extract.py writes (JSON lines on stdin).
 *
 *   node tools/performance/perfrun.js segments [performance.json] < samples.jsonl
 *       one JSON line per steady segment: what perf_train.py fits
 *   node tools/performance/perfrun.js kpis [performance.json] [--every 60] < samples.jsonl
 *       the KPI list every N seconds of flight, then a summary line
 *
 * An extra algorithm (a professional build) can be loaded with --require <file.js>:
 * the file calls PerformanceAlgorithms.register() like the HMI addon would.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const perf = require(path.join(__dirname, "..", "..", "web", "RB-01", "js", "perfengine.js"));
global.PerformanceAlgorithms = perf.PerformanceAlgorithms;

const args = process.argv.slice(2);
const mode = args.shift();
let configPath = null, every = 60;
while (args.length) {
    const a = args.shift();
    if (a === "--every") every = Number(args.shift());
    else if (a === "--require") require(path.resolve(args.shift()));
    else configPath = a;
}
if (mode !== "segments" && mode !== "kpis") {
    console.error("usage: perfrun.js segments|kpis [performance.json] [--every s] [--require algo.js] < samples.jsonl");
    process.exit(2);
}
const config = configPath ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
const engine = new perf.PerformanceEngine(config);
engine.collect = false;

const summary = {};
let lastPrint = null, lastT = null, segments = 0;
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
    if (!line.trim()) return;
    const s = JSON.parse(line);
    if (!s.ems) s.ems = {};
    const seg = engine.observe(s);
    if (seg) {
        segments++;
        if (mode === "segments") process.stdout.write(JSON.stringify(seg) + "\n");
    }
    if (mode === "kpis" && engine.lastT !== null) {
        lastT = engine.lastT;
        if (lastPrint === null || lastT < lastPrint || lastT - lastPrint >= every) {
            lastPrint = lastT;
            const k = engine.kpis();
            const row = { t: Math.round(lastT) };
            k.forEach((x) => {
                row[x.id] = x.value === null ? x.status : Math.round(x.value);
                if (x.value !== null) (summary[x.id] = summary[x.id] || []).push(x.value);
            });
            process.stdout.write(JSON.stringify(row) + "\n");
        }
    }
});
rl.on("close", () => {
    if (mode !== "kpis") return;
    const out = { summary: true, segments: segments };
    for (const id in summary) {
        const v = summary[id].slice().sort((a, b) => a - b);
        out[id] = { n: v.length, min: Math.round(v[0]), median: Math.round(v[v.length >> 1]), max: Math.round(v[v.length - 1]) };
    }
    process.stdout.write(JSON.stringify(out) + "\n");
});
