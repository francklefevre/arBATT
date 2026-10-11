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
#
# 2026-10-07 (v0.1.14): also the SINGLE builder of the client configuration
# www/app-config.json (build_app_config / write_app_config), previously
# duplicated in server.py, deploy/update.sh and tests/dom_harness.js (the
# copies had drifted: the versioned file still said 0.1.12). Command line:
#   python3 arbatt_config.py --print          # JSON on stdout
#   python3 arbatt_config.py --write [webroot] # writes <webroot>/app-config.json
# ---------------------------------------------------------------------------

import os
import sys
import json


CONFIG_DIR = "config"
PARAM_FILE = "param.json"
SECRET_FILE = "secret.json"
APP_CONFIG_FILE = "app-config.json"


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


def build_app_config(config):
    """Return the client configuration published to the PWA.

    Its content is driven by the ARBATT_APP_CONFIG_KEYS mapping
    ({clientKey: PARAM_NAME}) of param.json, plus "version". A missing key
    raises KeyError on purpose: a silent default would hide a broken config.
    """
    app_config = {"version": config["version"]}
    for client_key, param in config["ARBATT_APP_CONFIG_KEYS"].items():
        app_config[client_key] = config[param]
    return app_config


def write_app_config(config, webroot):
    """Write <webroot>/app-config.json; return (path, app_config)."""
    app_config = build_app_config(config)
    path = os.path.join(webroot, APP_CONFIG_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(app_config, fh)
    return path, app_config


def main(argv):
    """CLI used by deploy/update.sh and tests/dom_harness.js."""
    config = load_config()
    if len(argv) >= 1 and argv[0] == "--print":
        # Program OUTPUT (consumed by other tools), not a log line.
        sys.stdout.write(json.dumps(build_app_config(config)) + "\n")
        return 0
    if len(argv) >= 1 and argv[0] == "--write":
        from arbatt_log import Logger
        logger = Logger(program_name="arbatt_config",
                        log_dir=config.get("ARBATT_LOG_DIR", "logs"),
                        tags=config.get("ARBATT_LOG_TAGS", {}),
                        to_console=config.get("ARBATT_LOG_TO_CONSOLE", True),
                        to_file=config.get("ARBATT_LOG_TO_FILE", True))
        webroot = argv[1] if len(argv) > 1 else config.get("ARBATT_WEBROOT", "www")
        path, app_config = write_app_config(config, webroot)
        logger.log("CONFIG", 1100, "Wrote %s (version %s)" % (path, app_config["version"]))
        return 0
    sys.stderr.write("usage: python3 arbatt_config.py --print | --write [webroot]\n")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
