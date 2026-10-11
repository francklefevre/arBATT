# -*- coding: utf-8 -*-
#
# arBATT - Table tennis club referee companion (PWA)
#
# Free software: you may do whatever you want with it.
# Developed by Franck LEFEVRE for K1 ( https://k1info.com ),
# with the help of his team of kind and playful robots.
#
# Please use the enormous power of this software to do good things
# for things and people, always making sure it harms nothing and no one.
#
# ---------------------------------------------------------------------------
# 2026-10-07 (v0.1.14): tests of the single client-config builder
# (arbatt_config.build_app_config / write_app_config / CLI). Also guards the
# VERSIONED www/app-config.json, which is what static hosting serves: it must
# match config/param.json (it had silently stayed at 0.1.12 before).
#
# Run with:  python3 tests/test_app_config.py   (also run by npm test)
# ---------------------------------------------------------------------------

import os
import sys
import json
import tempfile
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.chdir(ROOT)  # load_config() reads config/ relative to the repo root

import arbatt_config  # noqa: E402

FAILS = 0


def ok(cond, msg):
    global FAILS
    if not cond:
        FAILS += 1
        print("FAIL:", msg)
    else:
        print("ok  :", msg)


cfg = arbatt_config.load_config()
app = arbatt_config.build_app_config(cfg)
mapping = cfg["ARBATT_APP_CONFIG_KEYS"]

ok(app["version"] == cfg["version"], "version published")
ok(set(app) == set(mapping) | {"version"}, "exactly the mapped keys + version")
ok(all(app[k] == cfg[p] for k, p in mapping.items()), "values taken from the parameters")
ok(isinstance(app["warmupSeconds"], int), "types preserved (int)")

# Environment override flows through (same name as the parameter).
env = dict(os.environ, ARBATT_WARMUP_SECONDS="30")
out = subprocess.run([sys.executable, "arbatt_config.py", "--print"], cwd=ROOT,
                     env=env, capture_output=True, text=True)
ok(out.returncode == 0 and json.loads(out.stdout)["warmupSeconds"] == 30,
   "env override applied and coerced to int (CLI --print)")

# A mapping to an unknown parameter is an error, not a silent default.
broken = dict(cfg, ARBATT_APP_CONFIG_KEYS={"x": "ARBATT_DOES_NOT_EXIST"})
try:
    arbatt_config.build_app_config(broken)
    ok(False, "unknown parameter in the mapping raises")
except KeyError:
    ok(True, "unknown parameter in the mapping raises")

# --write writes the file (temp web-root, never the real one).
tmp = tempfile.mkdtemp()
out = subprocess.run([sys.executable, "arbatt_config.py", "--write", tmp], cwd=ROOT,
                     env=dict(os.environ, ARBATT_LOG_DIR=tmp),
                     capture_output=True, text=True)
written = json.load(open(os.path.join(tmp, "app-config.json")))
ok(out.returncode == 0 and written == app, "CLI --write produces the same document")

# The versioned file served by static hosting must be up to date.
shipped = json.load(open(os.path.join(ROOT, "www", "app-config.json")))
ok(shipped == app, "www/app-config.json is in sync with config/param.json "
   "(regenerate: python3 arbatt_config.py --write)")

print("ALL APP-CONFIG TESTS PASSED" if FAILS == 0 else "%d APP-CONFIG TEST(S) FAILED" % FAILS)
sys.exit(0 if FAILS == 0 else 1)
