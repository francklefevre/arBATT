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
# Tests of the live relay API (scoreboard / OBS mode).
#
# 2026-10-06 (v0.1.12): created for the Python relay (arbatt_live.LiveHub +
#   server.py /api/live/ routes) against a REAL ThreadingHTTPServer.
# 2026-10-06 (v0.1.13): refactored so the SAME HTTP assertions run against
#   BOTH implementations: the Python relay and the PHP relay of static hosting
#   (www/api/live.php, served by `php -S` + tests/php_live_router.php, which
#   reproduces the www/api/.htaccess rewrite). Both must stay interchangeable
#   for www/js/live.js. Added Last-Event-ID checks (reconnection) and, for
#   PHP, the bounded SSE response. The PHP part is reported as SKIPPED (not
#   failed) when no `php` binary is installed.
#
# Run with:  python3 tests/test_live_relay.py   (also run by npm test)
# ---------------------------------------------------------------------------

import os
import sys
import json
import time
import shutil
import socket
import tempfile
import threading
import subprocess
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from arbatt_log import Logger          # noqa: E402
from arbatt_live import LiveHub        # noqa: E402
import server                          # noqa: E402

FAILS = 0
MAX_BYTES = 2048
MAX_CHANNELS = 3


def ok(cond, msg):
    global FAILS
    if not cond:
        FAILS += 1
        print("FAIL:", msg)
    else:
        print("ok  :", msg)


# ------------------------------------------------------------ HTTP helpers
def request(url, data=None, headers=None, method=None):
    """Return (status, parsed JSON or raw bytes)."""
    req = urllib.request.Request(url, data=data, headers=headers or {},
                                 method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        body, status = e.read(), e.code
    try:
        return status, json.loads(body.decode("utf-8"))
    except ValueError:
        return status, body


def read_sse(base, channel, count, timeout=6, last_id=None):
    """Read up to `count` SSE data payloads (raw socket). Returns
    (events, closed_by_server)."""
    host, port = base.replace("http://", "").split(":")
    s = socket.create_connection((host, int(port)), timeout=timeout)
    extra = "Last-Event-ID: %s\r\n" % last_id if last_id is not None else ""
    s.sendall(("GET /api/live/%s/events HTTP/1.1\r\nHost: x\r\n%s"
               "Connection: close\r\n\r\n" % (channel, extra)).encode())
    buf, events, closed = b"", [], False
    deadline = time.time() + timeout
    try:
        while len(events) < count and time.time() < deadline:
            chunk = s.recv(4096)
            if not chunk:
                closed = True
                break
            buf += chunk
            while b"\n\n" in buf:
                block, buf = buf.split(b"\n\n", 1)
                for line in block.split(b"\n"):
                    if line.startswith(b"data: "):
                        events.append(json.loads(line[6:].decode("utf-8")))
    except socket.timeout:
        pass
    s.close()
    return events, closed


def sse_while_publishing(base, channel, payload, last_id=None):
    """Open a stream, publish `payload` 0.5 s later, return received events."""
    result = {}
    t = threading.Thread(target=lambda: result.update(
        ev=read_sse(base, channel, 2 if last_id is None else 1, last_id=last_id)[0]))
    t.start()
    time.sleep(0.5)
    request(base + "/api/live/" + channel, payload)
    t.join(8)
    return result.get("ev", [])


# ------------------------------------------------------- shared API suite
def api_suite(base, name):
    """Behaviour every relay implementation must have."""
    st, info = request(base + "/api/live/_info")
    ok(st == 200 and info == {"relay": True, "tokenRequired": False}, name + ": info endpoint")
    ok(request(base + "/api/live/chan1")[0] == 404, name + ": no document yet -> 404")

    st, r = request(base + "/api/live/chan1", b'{"a": 1}')
    ok(st == 200 and r == {"seq": 1}, name + ": publish returns seq 1")
    st, doc = request(base + "/api/live/chan1")
    ok(st == 200 and doc == {"a": 1}, name + ": latest document served")
    st, _ = request(base + "/api/live/chan1", b"{}")
    ok(st == 200 and request(base + "/api/live/chan1")[1] == {},
       name + ": empty object accepted and kept as an object")

    ev = sse_while_publishing(base, "chan1", b'{"a": 2,\n "multi": "line", "u": "\xc3\xa9/x"}')
    ok(len(ev) == 2 and ev[0] == {} and ev[1].get("a") == 2 and ev[1].get("u") == "é/x",
       name + ": SSE delivers latest then newer (multi-line JSON compacted, UTF-8)")

    # Reconnection: EventSource sends the last id it saw -> no duplicate.
    st, r = request(base + "/api/live/chan1", b'{"a": 3}')
    ev = sse_while_publishing(base, "chan1", b'{"a": 4}', last_id=r["seq"])
    ok(len(ev) == 1 and ev[0] == {"a": 4},
       name + ": Last-Event-ID skips the already-seen document")

    ok(request(base + "/api/live/chan1", b"[1,2]")[0] == 400, name + ": non-object JSON refused")
    ok(request(base + "/api/live/chan1", b"not json")[0] == 400, name + ": invalid JSON refused")
    ok(request(base + "/api/live/bad%20id", b"{}")[0] == 400, name + ": invalid channel id refused")
    big = b'{"x":"' + b"y" * (MAX_BYTES + 100) + b'"}'
    ok(request(base + "/api/live/chan1", big)[0] == 413, name + ": oversized document refused")
    ok(request(base + "/api/live/chan1/nope")[0] == 404, name + ": unknown sub-route -> 404")

    # Eviction: at most MAX_CHANNELS, the least recently updated one goes.
    for c in ("c2", "c3", "c4"):
        time.sleep(1.05)  # distinct mtimes for the file-based PHP store
        request(base + "/api/live/" + c, b"{}")
    ok(request(base + "/api/live/chan1")[0] == 404 and
       request(base + "/api/live/c4")[0] == 200,
       name + ": oldest channel evicted at the limit")

    ok(request(base + "/scoreboard.html")[0] == 200, name + ": static overlay page served")


def token_suite(base, name):
    ok(request(base + "/api/live/_info")[1]["tokenRequired"] is True, name + ": token advertised")
    ok(request(base + "/api/live/k", b"{}")[0] == 403, name + ": publish without token -> 403")
    ok(request(base + "/api/live/k", b"{}", {"X-Arbatt-Token": "nope"})[0] == 403,
       name + ": publish with a wrong token -> 403")
    ok(request(base + "/api/live/k", b"{}", {"X-Arbatt-Token": "s3cret"})[0] == 200,
       name + ": publish with the token -> 200")
    ok(request(base + "/api/live/k")[0] == 200, name + ": reading needs no token")


def disabled_suite(base, name):
    ok(request(base + "/api/live/_info")[0] == 404, name + ": disabled relay -> 404 on info")
    ok(request(base + "/api/live/k", b"{}")[0] == 404, name + ": disabled relay -> 404 on publish")


# ------------------------------------------------------------ Python relay
def make_logger():
    # Test logs go to a temp dir: never pollute the app's logs/.
    return Logger("test_live_relay", log_dir=tempfile.mkdtemp(),
                  tags={"DEBUG": False}, to_console=False, to_file=True)


def start_python(extra_cfg=None, relay=True):
    cfg = {"ARBATT_WEBROOT": os.path.join(ROOT, "www"),
           "ARBATT_LIVE_KEEPALIVE_SECONDS": 1}
    cfg.update(extra_cfg or {})
    logger = make_logger()
    hub = LiveHub(MAX_BYTES, MAX_CHANNELS, logger) if relay else None
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(cfg, logger, hub))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


def python_suites():
    httpd, base = start_python()
    api_suite(base, "py")
    ok(request(base + "/api/live.php")[0] == 404, "py: PHP source never served by server.py")
    httpd.shutdown()
    httpd, base = start_python({"ARBATT_LIVE_TOKEN": "s3cret"})
    token_suite(base, "py")
    httpd.shutdown()
    httpd, base = start_python(relay=False)
    disabled_suite(base, "py")
    httpd.shutdown()


# --------------------------------------------------------------- PHP relay
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def start_php(extra_env=None):
    """php -S on www/ with the test router; isolated config/data/log dirs."""
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "config"))  # empty: defaults + env only
    env = dict(os.environ,
               ARBATT_CONFIG_DIR=os.path.join(tmp, "config"),
               ARBATT_LIVE_PHP_DATA_DIR=os.path.join(tmp, "data"),
               ARBATT_LOG_DIR=os.path.join(tmp, "logs"),
               ARBATT_LIVE_MAX_BYTES=str(MAX_BYTES),
               ARBATT_LIVE_MAX_CHANNELS=str(MAX_CHANNELS),
               ARBATT_LIVE_KEEPALIVE_SECONDS="1",
               ARBATT_LIVE_PHP_STREAM_SECONDS="3",
               ARBATT_LIVE_PHP_POLL_MS="100",
               PHP_CLI_SERVER_WORKERS="4")   # concurrent SSE + POST
    env.update(extra_env or {})
    port = free_port()
    proc = subprocess.Popen(
        ["php", "-S", "127.0.0.1:%d" % port, "-t", os.path.join(ROOT, "www"),
         os.path.join(ROOT, "tests", "php_live_router.php")],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = "http://127.0.0.1:%d" % port
    for _ in range(50):  # wait until it accepts connections
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.1)
    return proc, base, tmp


def stop_php(proc, tmp):
    proc.terminate()
    proc.wait(5)
    shutil.rmtree(tmp, ignore_errors=True)


def php_suites():
    if shutil.which("php") is None:
        print("SKIP: php not installed — PHP relay not tested")
        return
    proc, base, tmp = start_php()
    try:
        api_suite(base, "php")
        # Bounded SSE response: the server ends it, EventSource reconnects.
        t0 = time.time()
        _, closed = read_sse(base, "c4", 99, timeout=8)
        ok(closed and 2 <= time.time() - t0 < 7,
           "php: SSE response ends after ARBATT_LIVE_PHP_STREAM_SECONDS")
        errs = os.path.join(tmp, "logs", "live_php.err.txt")
        ok(os.path.exists(errs) and "#6631" in open(errs).read(),
           "php: rejected publications logged in live_php.err.txt")
    finally:
        stop_php(proc, tmp)
    proc, base, tmp = start_php({"ARBATT_LIVE_TOKEN": "s3cret"})
    try:
        token_suite(base, "php")
    finally:
        stop_php(proc, tmp)
    # Apache SetEnv seen as REDIRECT_<name> in $_SERVER (PHP-FPM + rewrite).
    proc, base, tmp = start_php({"ARBATT_TEST_REDIRECT_TOKEN": "s3cret"})
    try:
        token_suite(base, "php(REDIRECT_ env)")
    finally:
        stop_php(proc, tmp)
    proc, base, tmp = start_php({"ARBATT_LIVE_RELAY": "false"})
    try:
        disabled_suite(base, "php")
    finally:
        stop_php(proc, tmp)


def main():
    python_suites()
    php_suites()
    print("ALL RELAY TESTS PASSED" if FAILS == 0 else "%d RELAY TEST(S) FAILED" % FAILS)
    sys.exit(0 if FAILS == 0 else 1)


if __name__ == "__main__":
    main()
