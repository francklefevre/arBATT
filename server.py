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
#
# Event number convention used in this file: 1xxx.
# ---------------------------------------------------------------------------

import os
import sys
import json
import posixpath
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from arbatt_config import load_config
from arbatt_log import Logger

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


def make_handler(config, logger):
    """Build a request handler class bound to the given config and logger."""

    webroot = os.path.abspath(config.get("ARBATT_WEBROOT", "www"))
    server_header = config.get("ARBATT_SERVER_HEADER", "arBATT")
    default_document = config.get("ARBATT_DEFAULT_DOCUMENT", "index.html")

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
            self._handle(write_body=True)

        def do_HEAD(self):
            self._handle(write_body=False)

        def _handle(self, write_body):
            target = self._resolve(self.path)
            if target is None:
                logger.log("SECURITY", 1001,
                           "Rejected path traversal attempt: %r from %s"
                           % (self.path, self.client_address[0]))
                self._send(403, b"403 Forbidden")
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
    # 2026-06-02: extended from a bare version.json to a richer app-config.json
    # to expose the warm-up / time-out durations to the front-end without
    # duplicating their default values in the JavaScript.
    app_config = {
        "version": version,
        "warmupSeconds": int(config.get("ARBATT_WARMUP_SECONDS", 120)),
        "timeoutSeconds": int(config.get("ARBATT_TIMEOUT_SECONDS", 60)),
        "accelReturns": int(config.get("ARBATT_ACCEL_RETURNS", 13)),
    }
    config_path = os.path.join(webroot, "app-config.json")
    try:
        with open(config_path, "w", encoding="utf-8") as fh:
            json.dump(app_config, fh)
        logger.log("CONFIG", 1011, "Published app-config.json (%s)" % app_config)
    except OSError as exc:
        logger.log("WARN", 1012, "Could not write app-config.json: %s" % exc)

    handler = make_handler(config, logger)
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
