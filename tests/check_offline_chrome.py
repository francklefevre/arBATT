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
# 2026-10-07 (v0.1.14): REAL-BROWSER offline check of the PWA (manual check,
# not part of `npm test` because it needs Google Chrome / Chromium).
#
#   1. starts server.py on a free port and a headless Chrome (fresh profile,
#      remote debugging), opens http://localhost:<port>/ (localhost is a
#      secure context, so the service worker installs);
#   2. waits for the service worker to control the page and checks the cache;
#   3. STOPS THE SERVER (real offline: nothing answers any more);
#   4. reloads and verifies the app works from the cache only: version from
#      app-config.json, a full rally of points on the scoreboard, the match
#      sheet, and the overlay page (scoreboard.html?demo=1).
#
# Zero dependency: a minimal Chrome DevTools Protocol client over a raw
# WebSocket is embedded below.
#
# Run with:  python3 tests/check_offline_chrome.py
# ---------------------------------------------------------------------------

import os
import sys
import json
import time
import base64
import shutil
import socket
import tempfile
import subprocess
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAILS = 0


def ok(cond, msg):
    global FAILS
    if not cond:
        FAILS += 1
        print("FAIL:", msg)
    else:
        print("ok  :", msg)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_port(port, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return True
        except OSError:
            time.sleep(0.1)
    return False


class Cdp:
    """Minimal CDP client: one page target, request/response by id."""

    def __init__(self, ws_url):
        hostport, path = ws_url.split("/", 3)[2], "/" + ws_url.split("/", 3)[3]
        host, port = hostport.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
                           "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
                           "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)).encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            resp += self.sock.recv(4096)
        self.next_id = 0

    def _send(self, obj):
        data = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(data)
        if n < 126:
            hdr = bytes([0x81, 0x80 | n])
        elif n < 65536:
            hdr = bytes([0x81, 0x80 | 126]) + n.to_bytes(2, "big")
        else:
            hdr = bytes([0x81, 0x80 | 127]) + n.to_bytes(8, "big")
        self.sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("CDP socket closed")
            buf += chunk
        return buf

    def _recv(self):
        h = self._recv_exact(2)
        n = h[1] & 127
        if n == 126:
            n = int.from_bytes(self._recv_exact(2), "big")
        elif n == 127:
            n = int.from_bytes(self._recv_exact(8), "big")
        return json.loads(self._recv_exact(n))

    def call(self, method, params=None):
        self.next_id += 1
        mid = self.next_id
        self._send({"id": mid, "method": method, "params": params or {}})
        while True:
            msg = self._recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("%s: %s" % (method, msg["error"]))
                return msg.get("result", {})

    def js(self, expr):
        """Evaluate an expression (promises awaited) and return its value."""
        r = self.call("Runtime.evaluate", {"expression": expr, "awaitPromise": True,
                                           "returnByValue": True})
        if "exceptionDetails" in r:
            raise RuntimeError("JS error: %s" % r["exceptionDetails"])
        return r["result"].get("value")

    def goto(self, url, settle=1.5):
        self.call("Page.navigate", {"url": url})
        time.sleep(settle)


def find_chrome():
    for name in ("google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            return path
    return None


def main():
    chrome = find_chrome()
    if chrome is None:
        print("SKIP: no Chrome/Chromium found")
        return 0

    port, dbg = free_port(), free_port()
    tmp = tempfile.mkdtemp()
    env = dict(os.environ, ARBATT_PORT=str(port), ARBATT_LOG_DIR=os.path.join(tmp, "logs"),
               ARBATT_LOG_TO_CONSOLE="false")
    server = subprocess.Popen([sys.executable, "server.py"], cwd=ROOT, env=env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser = subprocess.Popen([chrome, "--headless=new", "--no-sandbox", "--disable-gpu",
                                "--user-data-dir=" + os.path.join(tmp, "profile"),
                                "--remote-debugging-port=%d" % dbg, "about:blank"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        ok(wait_port(port), "server.py started")
        ok(wait_port(dbg), "Chrome started")
        time.sleep(0.5)
        target = json.load(urllib.request.urlopen(urllib.request.Request(
            "http://127.0.0.1:%d/json/new?about:blank" % dbg, method="PUT")))
        cdp = Cdp(target["webSocketDebuggerUrl"])
        cdp.call("Page.enable")
        base = "http://localhost:%d/" % port

        # --- online: install the service worker -----------------------------
        cdp.goto(base)
        cdp.js("navigator.serviceWorker.ready.then(function () { return true; })")
        cdp.goto(base)  # 2nd load: the page is now CONTROLLED by the SW
        ok(cdp.js("!!navigator.serviceWorker.controller"), "service worker controls the page")
        cache_name = cdp.js("caches.keys().then(function (k) { return k.join(','); })")
        version = json.load(open(os.path.join(ROOT, "config", "param.json")))["version"]
        ok(cache_name == "arbatt-v" + version.replace(".", "_"),
           "cache named after the version (%s)" % cache_name)
        n = cdp.js("caches.open('%s').then(function (c) { return c.keys(); })"
                   ".then(function (k) { return k.length; })" % cache_name)
        ok(n >= 20, "app shell pre-cached (%s entries)" % n)

        # --- OFFLINE: stop the server for real ------------------------------
        server.terminate()
        server.wait(5)
        try:
            urllib.request.urlopen(base, timeout=2)
            ok(False, "server is really down")
        except OSError:
            ok(True, "server is really down (nothing answers on %d)" % port)

        cdp.goto(base, settle=2)
        ok(cdp.js("document.getElementById('version').textContent") == "v" + version,
           "offline reload: app shell + version from the cached app-config.json")
        ok(cdp.js("!document.getElementById('screen-menu').classList.contains('hidden')"),
           "offline: home menu displayed")

        # Play a few points.
        cdp.js("""(function () {
            document.querySelector("#screen-menu [data-target='screen-newmatch']").click();
            document.getElementById('nameA').value = 'Hors';
            document.getElementById('nameB').value = 'Ligne';
            document.getElementById('form-newmatch').requestSubmit();
            ['card-0','card-0','card-1','card-0'].forEach(function (id) {
              document.getElementById(id).click();
            });
            return true; })()""")
        score = cdp.js("document.getElementById('points-0').textContent + '-' + "
                       "document.getElementById('points-1').textContent")
        ok(score == "3-1", "offline: points counted on the scoreboard (%s)" % score)
        ok(cdp.js("document.getElementById('name-0').textContent") == "Hors",
           "offline: player names applied")

        # Match sheet still works (localStorage, no network).
        cdp.js("""(function () {
            document.getElementById('btn-quit').click();
            document.querySelector("#screen-menu [data-target='screen-sheet']").click();
            document.getElementById('sheet-sideA').value = 'A';
            document.getElementById('sheet-sideB').value = 'B';
            document.getElementById('sheet-add-btn').click();
            return true; })()""")
        ok(cdp.js("document.querySelectorAll('#sheet-list .sheet-row').length") == 1,
           "offline: match sheet usable")

        # Overlay page from the cache too.
        cdp.goto(base + "scoreboard.html?demo=1", settle=2.5)
        ok(cdp.js("!document.getElementById('bug').classList.contains('hidden')"),
           "offline: scoreboard.html (overlay) served from the cache")
    finally:
        browser.terminate()
        if server.poll() is None:
            server.terminate()
        browser.wait(5)
        shutil.rmtree(tmp, ignore_errors=True)

    print("OFFLINE CHECK PASSED" if FAILS == 0 else "%d OFFLINE CHECK(S) FAILED" % FAILS)
    return 0 if FAILS == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
