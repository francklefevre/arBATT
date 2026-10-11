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
# Very basic static web server dedicated to serving the arBATT PWA.
#
# Design goals:
#   - Serve files from a SINGLE web-root directory and nothing outside it
#     (every request path is sandboxed; path traversal is rejected).
#   - Be fully parameterised (host, port, web-root, Server header, ...).
#   - Route every piece of output through the centralised Logger.
#   - 2026-10-06 (v0.1.12): host the optional LIVE RELAY used by the
#     scoreboard/OBS mode (see arbatt_live.py and the /api/live/ routes below).
#
# Event number convention used in this file: 1xxx.
# ---------------------------------------------------------------------------

import os
import sys
import json
import hmac
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from arbatt_config import load_config, write_app_config
from arbatt_log import Logger
from arbatt_live import LiveHub, LiveError

PROGRAM_NAME = "server"

# Minimal MIME table. Kept explicit so the PWA assets are always served with
# the correct content type, independently of the host's mime database.
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
}


# URL prefix of the live relay API. Any path under it is handled by the relay
# (or answered 404 when the relay is disabled), never by the static files.
LIVE_PREFIX = "/api/live/"


def make_handler(config, logger, hub=None):
    """Build a request handler class bound to the given config and logger.

    `hub` is the LiveHub serving the scoreboard relay, or None when the relay
    is disabled (ARBATT_LIVE_RELAY=false): /api/live/ then answers 404, exactly
    like a plain static host, so the PWA reports "relay unavailable".
    """

    webroot = os.path.abspath(config.get("ARBATT_WEBROOT", "www"))
    server_header = config.get("ARBATT_SERVER_HEADER", "arBATT")
    default_document = config.get("ARBATT_DEFAULT_DOCUMENT", "index.html")
    live_token = str(config.get("ARBATT_LIVE_TOKEN", "") or "")
    live_keepalive = float(config.get("ARBATT_LIVE_KEEPALIVE_SECONDS", 15))

    class ArbattHandler(BaseHTTPRequestHandler):
        # Advertised server identity (parameterised, never the real stack).
        server_version = server_header
        sys_version = ""

        # --- Internal helpers ------------------------------------------------

        def _resolve(self, url_path):
            """Map a URL path to a safe absolute filesystem path.

            Returns the absolute path inside the web-root, or None when the
            request tries to escape the web-root (path traversal attempt).
            """
            # Strip query/fragment, decode percent-encoding, normalise.
            path = urllib.parse.urlparse(url_path).path
            path = urllib.parse.unquote(path)
            path = posixpath.normpath(path)

            # Build the candidate path and ensure it stays within the root.
            candidate = os.path.normpath(os.path.join(webroot, path.lstrip("/")))
            if candidate != webroot and not candidate.startswith(webroot + os.sep):
                return None

            if os.path.isdir(candidate):
                candidate = os.path.join(candidate, default_document)
            return candidate

        def _send(self, status, body=b"", content_type="text/plain; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            # Service workers require the app shell to be reachable; we keep
            # caching conservative and let the SW manage offline caching.
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if body:
                self.wfile.write(body)

        # --- HTTP verbs ------------------------------------------------------

        def do_GET(self):
            if self._is_live():
                self._live_get()
                return
            self._handle(write_body=True)

        def do_HEAD(self):
            self._handle(write_body=False)

        def do_POST(self):
            if self._is_live():
                self._live_post()
                return
            self._send(405, b"405 Method Not Allowed")

        # --- Live relay (scoreboard / OBS mode) ------------------------------
        # 2026-10-06 (v0.1.12): added. Routes:
        #   GET  /api/live/_info            -> {"relay":true,"tokenRequired":b}
        #   GET  /api/live/<ch>             -> latest JSON document (404 if none)
        #   GET  /api/live/<ch>/events      -> Server-Sent Events stream
        #   POST /api/live/<ch>             -> publish (X-Arbatt-Token if set)

        def _is_live(self):
            path = urllib.parse.urlparse(self.path).path
            return path.startswith(LIVE_PREFIX)

        def _live_parts(self):
            """Return the path segments after /api/live/ (decoded)."""
            path = urllib.parse.urlparse(self.path).path[len(LIVE_PREFIX):]
            return [urllib.parse.unquote(p) for p in path.split("/") if p]

        def _send_json(self, status, obj):
            body = json.dumps(obj).encode("utf-8")
            self._send(status, body, "application/json; charset=utf-8")

        def _live_get(self):
            if hub is None:
                self._send(404, b"404 Not Found")
                return
            parts = self._live_parts()
            if parts == ["_info"]:
                self._send_json(200, {"relay": True,
                                      "tokenRequired": bool(live_token)})
                return
            if not parts or not hub.valid_channel(parts[0]) or len(parts) > 2:
                self._send(400, b"400 Bad Request")
                return
            channel = parts[0]
            if len(parts) == 2:
                if parts[1] != "events":
                    self._send(404, b"404 Not Found")
                    return
                self._live_stream(channel)
                return
            latest = hub.latest(channel)
            if latest is None:
                self._send(404, b"404 Not Found")
                return
            self._send(200, latest[1], "application/json; charset=utf-8")

        def _live_post(self):
            if hub is None:
                self._send(404, b"404 Not Found")
                return
            parts = self._live_parts()
            if len(parts) != 1:
                self._send(400, b"400 Bad Request")
                return
            # Optional shared secret: when ARBATT_LIVE_TOKEN is set, only the
            # referee app configured with that token may publish.
            if live_token:
                given = self.headers.get("X-Arbatt-Token", "")
                if not hmac.compare_digest(given, live_token):
                    logger.log("SECURITY", 1020, "Live publish refused (bad "
                               "token) on %r from %s"
                               % (parts[0], self.client_address[0]))
                    self._send_json(403, {"error": "bad token"})
                    return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = -1
            if length < 0 or length > hub.max_bytes:
                self._send_json(413, {"error": "document too large"})
                return
            body = self.rfile.read(length)
            try:
                seq = hub.publish(parts[0], body)
            except LiveError as exc:
                logger.log("WARN", 1021, "Live publish rejected on %r: %s"
                           % (parts[0], exc))
                self._send_json(exc.status, {"error": str(exc)})
                return
            self._send_json(200, {"seq": seq})

        def _live_stream(self, channel):
            """Serve an SSE stream of the channel's documents until the client
            goes away. The latest document (if any) is sent immediately, then
            every newer one; a comment line keeps idle connections alive."""
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            # Disable proxy buffering (nginx) so events are not delayed.
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            logger.log("LIVE", 1022, "SSE subscriber on %s from %s"
                       % (channel, self.client_address[0]))
            # 2026-10-06 (v0.1.13): honour Last-Event-ID (sent by EventSource
            # when it reconnects) like the PHP relay: an unchanged document is
            # not sent again.
            try:
                seq = int(self.headers.get("Last-Event-ID", "0"))
            except ValueError:
                seq = 0
            try:
                latest = hub.latest(channel)
                if latest is not None and latest[0] != seq:
                    seq = latest[0]
                    self._sse_write(seq, latest[1])
                while True:
                    newer = hub.wait_newer(channel, seq, live_keepalive)
                    if newer is None:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                        continue
                    seq = newer[0]
                    self._sse_write(seq, newer[1])
            except (BrokenPipeError, ConnectionResetError, OSError):
                logger.log("LIVE", 1023, "SSE subscriber left %s (%s)"
                           % (channel, self.client_address[0]))

        def _sse_write(self, seq, body):
            # body is a single-line compact JSON (guaranteed by LiveHub).
            self.wfile.write(b"id: " + str(seq).encode("ascii") +
                             b"\ndata: " + body + b"\n\n")
            self.wfile.flush()

        def _handle(self, write_body):
            target = self._resolve(self.path)
            if target is None:
                logger.log("SECURITY", 1001,
                           "Rejected path traversal attempt: %r from %s"
                           % (self.path, self.client_address[0]))
                self._send(403, b"403 Forbidden")
                return

            # Hidden files (dotfiles such as .htaccess) are never served: they
            # are deployment/config artifacts, not public content. We answer 404
            # so their very existence stays undisclosed.
            rel = os.path.relpath(target, webroot)
            if any(part.startswith(".") for part in rel.split(os.sep)
                   if part not in (".", "..")):
                logger.log("SECURITY", 1013, "Blocked hidden file: %r" % self.path)
                self._send(404, b"404 Not Found")
                return

            # 2026-10-06 (v0.1.13): server-side PHP sources (the static-hosting
            # live relay www/api/live.php) are never served as text: this
            # server does not execute PHP, and sources are not public content.
            if target.lower().endswith(".php"):
                logger.log("SECURITY", 1014, "Blocked PHP source: %r" % self.path)
                self._send(404, b"404 Not Found")
                return

            if not os.path.isfile(target):
                logger.log("HTTP", 1002, "404 %s -> %s" % (self.path, target))
                self._send(404, b"404 Not Found")
                return

            ext = os.path.splitext(target)[1].lower()
            ctype = MIME_TYPES.get(ext, "application/octet-stream")
            try:
                with open(target, "rb") as fh:
                    body = fh.read()
            except OSError as exc:
                logger.log("ERROR", 1003, "Cannot read %s: %s" % (target, exc))
                self._send(500, b"500 Internal Server Error")
                return

            logger.log("HTTP", 1004, "200 %s (%d bytes, %s)"
                       % (self.path, len(body), ctype))
            self._send(200, body if write_body else b"", ctype)

        # Silence the default stderr logging; route through our Logger instead.
        def log_message(self, fmt, *args):  # noqa: A003 - base class signature
            logger.log("HTTP", 1005, fmt % args)

    return ArbattHandler


def main():
    config = load_config()

    logger = Logger(
        program_name=PROGRAM_NAME,
        log_dir=config.get("ARBATT_LOG_DIR", "logs"),
        tags=config.get("ARBATT_LOG_TAGS", {}),
        to_console=config.get("ARBATT_LOG_TO_CONSOLE", True),
        to_file=config.get("ARBATT_LOG_TO_FILE", True),
    )

    version = config.get("version", "0.0.0")
    # The version number is displayed at every startup to ease debugging.
    logger.log("BOOT", 1000, "arBATT server starting - version %s" % version)

    host = config.get("ARBATT_HOST", "0.0.0.0")
    port = int(config.get("ARBATT_PORT", 8080))
    webroot = os.path.abspath(config.get("ARBATT_WEBROOT", "www"))

    if not os.path.isdir(webroot):
        logger.log("ERROR", 1006, "Web-root directory does not exist: %s" % webroot)
        sys.exit(1)

    logger.log("CONFIG", 1007, "host=%s port=%d webroot=%s server_header=%r"
               % (host, port, webroot, config.get("ARBATT_SERVER_HEADER")))

    # Publish the client-facing configuration into the web-root so the PWA can
    # display the version and read the timer durations, while keeping
    # config/param.json as the single source of truth.
    # 2026-10-07 (v0.1.14): built by arbatt_config.write_app_config() (single
    # builder shared with deploy/update.sh and the tests) instead of an inline
    # dict that had to be kept in sync by hand.
    try:
        config_path, app_config = write_app_config(config, webroot)
        logger.log("CONFIG", 1011, "Published %s (%s)" % (config_path, app_config))
    except OSError as exc:
        logger.log("WARN", 1012, "Could not write app-config.json: %s" % exc)

    # Live relay for the scoreboard / OBS mode (optional, in-memory only).
    hub = None
    if config.get("ARBATT_LIVE_RELAY", True):
        hub = LiveHub(max_bytes=config.get("ARBATT_LIVE_MAX_BYTES", 65536),
                      max_channels=config.get("ARBATT_LIVE_MAX_CHANNELS", 50),
                      logger=logger)
        logger.log("CONFIG", 1024, "Live relay enabled on %s (token %s, "
                   "max %s bytes, %s channels)"
                   % (LIVE_PREFIX,
                      "required" if config.get("ARBATT_LIVE_TOKEN") else "off",
                      hub.max_bytes, hub.max_channels))
    else:
        logger.log("CONFIG", 1025, "Live relay disabled (ARBATT_LIVE_RELAY)")

    handler = make_handler(config, logger, hub)
    httpd = ThreadingHTTPServer((host, port), handler)

    logger.log("BOOT", 1008, "Listening on http://%s:%d/ (serving %s)"
               % (host, port, webroot))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.log("BOOT", 1009, "Shutdown requested (KeyboardInterrupt)")
    finally:
        httpd.server_close()
        logger.log("BOOT", 1010, "arBATT server stopped")


if __name__ == "__main__":
    main()
