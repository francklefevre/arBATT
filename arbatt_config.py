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
# Configuration loader.
#
# Parameters live in two JSON files under "config/":
#   - param.json  : non-confidential parameters (committed)
#   - secret.json : confidential parameters (git-ignored)
#
# Any parameter can be overridden by an environment variable bearing the
# SAME name as the JSON key (e.g. the env var ARBATT_PORT overrides the
# "ARBATT_PORT" key). Environment values are coerced to the type of the
# default found in the JSON files (bool / int / float / str / json).
# ---------------------------------------------------------------------------

import os
import json


CONFIG_DIR = "config"
PARAM_FILE = "param.json"
SECRET_FILE = "secret.json"


def _load_json(path):
    """Load a JSON file, returning {} if it does not exist."""
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _coerce(raw, default):
    """Coerce the string `raw` (from an env var) to the type of `default`."""
    if isinstance(default, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    if isinstance(default, (dict, list)):
        return json.loads(raw)
    return raw


def load_config(config_dir=CONFIG_DIR):
    """Return the merged configuration dictionary.

    Merge order (later wins): param.json -> secret.json -> environment.
    Keys whose name starts with "_" are documentation helpers and are kept
    as-is (they are never overridden by the environment).
    """
    config = {}
    config.update(_load_json(os.path.join(config_dir, PARAM_FILE)))
    config.update(_load_json(os.path.join(config_dir, SECRET_FILE)))

    for key, default in list(config.items()):
        if key.startswith("_"):
            continue
        if key in os.environ:
            config[key] = _coerce(os.environ[key], default)

    return config
