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
# Centralised logging facility.
#
# Every piece of information produced by the application MUST go through the
# single routing function `Logger.log(...)`. Each emitted line is prefixed
# with an ISO timestamp, a bracketed [TAG] describing the nature of the
# information, and an event number (#NNNN) that makes it trivial to locate
# the exact call site that produced the line.
#
# Which tags are actually emitted is driven by configuration
# (ARBATT_LOG_TAGS) so that information categories can be turned on/off
# dynamically without touching the code.
# ---------------------------------------------------------------------------

import os
import sys
import datetime


class Logger:
    """Single, configurable routing point for all log output.

    Parameters
    ----------
    program_name : str
        Base name of the running program (e.g. "server"). Used to build the
        error file name "<program_name>.err.txt".
    log_dir : str
        Directory in which all log files are written. Created if missing.
    tags : dict[str, bool]
        Mapping "TAG" -> enabled. A line is only emitted when its tag is
        enabled (unknown tags default to enabled so nothing is lost silently).
    to_console : bool
        Whether enabled lines are echoed to the console.
    to_file : bool
        Whether enabled lines are appended to "<program_name>.log".
    """

    # Tags that must always be mirrored into the ".err.txt" error file,
    # whatever the console/file routing is.
    ERROR_TAGS = ("ERROR", "WARN")

    def __init__(self, program_name, log_dir="logs", tags=None,
                 to_console=True, to_file=True):
        self.program_name = program_name
        self.log_dir = log_dir
        self.tags = tags if tags is not None else {}
        self.to_console = to_console
        self.to_file = to_file

        os.makedirs(self.log_dir, exist_ok=True)

        self.log_path = os.path.join(self.log_dir, program_name + ".log")
        self.err_path = os.path.join(self.log_dir, program_name + ".err.txt")

        # The error file is emptied at every startup, as required, so that it
        # only ever contains the errors of the current run.
        try:
            with open(self.err_path, "w", encoding="utf-8") as fh:
                fh.write("")
        except OSError as exc:  # pragma: no cover - filesystem edge case
            sys.stderr.write("Cannot reset error file %s: %s\n"
                             % (self.err_path, exc))

    @staticmethod
    def _stamp():
        """Return a millisecond-precision ISO timestamp."""
        return datetime.datetime.now().isoformat(timespec="milliseconds")

    def is_enabled(self, tag):
        """Return True if lines bearing `tag` must be emitted."""
        return self.tags.get(tag, True)

    def log(self, tag, eid, message):
        """Route one log line.

        Parameters
        ----------
        tag : str
            Category of the information (e.g. "HTTP", "BOOT", "ERROR").
        eid : int
            Stable event number identifying the call site.
        message : str
            Human readable message.
        """
        line = "%s [%s] #%04d %s" % (self._stamp(), tag, int(eid), message)

        # Errors and warnings are always captured in the dedicated error file,
        # independently of the console/file routing, so they are never missed.
        if tag in self.ERROR_TAGS:
            try:
                with open(self.err_path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except OSError as exc:  # pragma: no cover
                sys.stderr.write("Cannot write error file: %s\n" % exc)

        if not self.is_enabled(tag):
            return

        if self.to_console:
            stream = sys.stderr if tag in self.ERROR_TAGS else sys.stdout
            stream.write(line + "\n")
            stream.flush()

        if self.to_file:
            try:
                with open(self.log_path, "a", encoding="utf-8") as fh:
                    fh.write(line + "\n")
            except OSError as exc:  # pragma: no cover
                sys.stderr.write("Cannot write log file: %s\n" % exc)
