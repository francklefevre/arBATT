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
# Live relay hub ("scoreboard mode").
#
# 2026-10-06 (v0.1.12): created. The referee's device PUBLISHES the live
# scoreboard state (one JSON document per channel) and any number of display
# pages (e.g. an OBS "Browser source" overlay) SUBSCRIBE to it through
# Server-Sent Events. The hub only keeps the LATEST document of each channel in
# memory: the state is a full snapshot (not a delta), so a late subscriber is
# immediately up to date and nothing needs to be persisted.
#
# Thread-safety: ThreadingHTTPServer serves each request in its own thread;
# all access goes through a single threading.Condition, which is also used to
# wake up the SSE streams waiting for a newer document.
#
# Event number convention used in this file: 6xxx.
# ---------------------------------------------------------------------------

import re
import json
import time
import threading

# A channel id is an opaque token chosen by the referee's app (a UUID in
# practice). Restricting the alphabet keeps URLs and log lines safe.
CHANNEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class LiveError(Exception):
    """Publication refused. `status` is the HTTP status to answer with."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class LiveHub:
    """In-memory store of the latest live document per channel.

    Parameters
    ----------
    max_bytes : int
        Maximum size of one published document (request body), in bytes.
    max_channels : int
        Maximum number of channels kept; the least recently updated channel is
        evicted when a new one would exceed this bound (memory cap).
    logger : arbatt_log.Logger
        Centralised logger.
    """

    def __init__(self, max_bytes, max_channels, logger):
        self.max_bytes = int(max_bytes)
        self.max_channels = int(max_channels)
        self.logger = logger
        self._cond = threading.Condition()
        # channel -> {"seq": int, "body": bytes, "updated": float}
        self._channels = {}

    @staticmethod
    def valid_channel(channel):
        """Return True if `channel` is an acceptable channel id."""
        return bool(CHANNEL_RE.match(channel or ""))

    def publish(self, channel, body):
        """Store `body` (raw JSON bytes) as the latest document of `channel`.

        Returns the new sequence number of the channel. Raises LiveError when
        the channel id, the size or the JSON payload is invalid.
        """
        if not self.valid_channel(channel):
            raise LiveError(400, "invalid channel id")
        if len(body) > self.max_bytes:
            raise LiveError(413, "document too large (%d > %d bytes)"
                            % (len(body), self.max_bytes))
        try:
            doc = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise LiveError(400, "invalid JSON: %s" % exc)
        if not isinstance(doc, dict):
            raise LiveError(400, "the document must be a JSON object")

        # Re-serialise compactly: guarantees a single-line payload, which is
        # REQUIRED by the SSE "data:" framing (a raw newline would split it).
        compact = json.dumps(doc, ensure_ascii=False,
                             separators=(",", ":")).encode("utf-8")

        with self._cond:
            entry = self._channels.get(channel)
            if entry is None:
                self._evict_if_needed()
                entry = {"seq": 0, "body": b"", "updated": 0.0}
                self._channels[channel] = entry
                self.logger.log("LIVE", 6001, "New live channel %s (%d active)"
                                % (channel, len(self._channels)))
            entry["seq"] += 1
            entry["body"] = compact
            entry["updated"] = time.time()
            seq = entry["seq"]
            self._cond.notify_all()

        self.logger.log("DEBUG", 6002, "Channel %s <- seq %d (%d bytes)"
                        % (channel, seq, len(compact)))
        return seq

    def _evict_if_needed(self):
        """Drop the least recently updated channel(s). Caller holds the lock."""
        while len(self._channels) >= self.max_channels > 0:
            oldest = min(self._channels,
                         key=lambda c: self._channels[c]["updated"])
            del self._channels[oldest]
            self.logger.log("WARN", 6003, "Live channel limit reached (%d): "
                            "evicted %s" % (self.max_channels, oldest))

    def latest(self, channel):
        """Return (seq, body) of the channel's latest document, or None."""
        with self._cond:
            entry = self._channels.get(channel)
            if entry is None:
                return None
            return entry["seq"], entry["body"]

    def wait_newer(self, channel, after_seq, timeout):
        """Block until `channel` has a document other than `after_seq`.

        Returns (seq, body), or None when `timeout` seconds elapsed first (the
        SSE loop then emits a keep-alive comment).
        """
        deadline = time.time() + timeout
        with self._cond:
            while True:
                entry = self._channels.get(channel)
                # "!=" rather than ">": if the channel was evicted and then
                # re-created, its sequence restarts at 1 and must still be
                # delivered to subscribers that had seen a higher number.
                if entry is not None and entry["seq"] != after_seq:
                    return entry["seq"], entry["body"]
                remaining = deadline - time.time()
                if remaining <= 0:
                    return None
                self._cond.wait(remaining)

    def channel_count(self):
        """Number of channels currently held (for logs / diagnostics)."""
        with self._cond:
            return len(self._channels)
