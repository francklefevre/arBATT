<?php
/*
 * arBATT - Table tennis club referee companion (PWA)
 *
 * Free software: you may do whatever you want with it.
 * Developed by Franck LEFEVRE for K1 ( https://k1info.com ),
 * with the help of his team of kind and playful robots.
 *
 * Please use the enormous power of this software to do good things
 * for things and people, always making sure it harms nothing and no one.
 *
 * ---------------------------------------------------------------------------
 * PHP live relay for the scoreboard / OBS mode, for STATIC hosting.
 *
 * 2026-10-06 (v0.1.13): created. Same HTTP API as the Python relay of
 * server.py (arbatt_live.py), so the PWA (www/js/live.js) needs no change:
 *
 *   GET  api/live/_info        -> {"relay":true,"tokenRequired":bool}
 *   GET  api/live/<ch>         -> latest JSON document (404 if none)
 *   GET  api/live/<ch>/events  -> Server-Sent Events stream
 *   POST api/live/<ch>         -> publish (X-Arbatt-Token if configured)
 *
 * www/api/.htaccess rewrites api/live/<path> to live.php?path=<path>.
 *
 * Differences with the Python relay, imposed by PHP's request model:
 *   - No shared memory between requests: the latest document of each channel
 *     is a FILE (<data dir>/<channel>.live: line 1 = seq, line 2 = compact
 *     JSON), written atomically (temp file + rename) under an flock().
 *   - Shared hosts kill long scripts: an SSE response lasts at most
 *     ARBATT_LIVE_PHP_STREAM_SECONDS, polling the file every
 *     ARBATT_LIVE_PHP_POLL_MS, then ends; EventSource reconnects by itself
 *     (after "retry:" ms) and sends Last-Event-ID, so an unchanged document
 *     is not sent twice.
 *   - Each request is a short-lived "program": the error file
 *     logs/live_php.err.txt is therefore NOT emptied per request (that would
 *     erase it constantly); delete it by hand to reset it.
 *
 * Configuration (same names as config/param.json / secret.json, overridable
 * by environment variables of the same name, e.g. Apache "SetEnv"):
 *   ARBATT_CONFIG_DIR  where param.json / secret.json live (env only;
 *                      default: <this file>/../../config, i.e. the repository
 *                      layout used by the git/symlink deployment)
 *   ARBATT_LIVE_RELAY, ARBATT_LIVE_MAX_BYTES, ARBATT_LIVE_MAX_CHANNELS,
 *   ARBATT_LIVE_KEEPALIVE_SECONDS, ARBATT_LIVE_TOKEN (secret),
 *   ARBATT_LIVE_PHP_DATA_DIR, ARBATT_LIVE_PHP_STREAM_SECONDS,
 *   ARBATT_LIVE_PHP_POLL_MS, ARBATT_LIVE_PHP_PAD_BYTES,
 *   ARBATT_LIVE_PHP_TIMEZONE, ARBATT_LOG_DIR,
 *   ARBATT_LOG_TAGS.
 *
 * Compatible with PHP >= 7.4. Event number convention in this file: 66xx.
 * ---------------------------------------------------------------------------
 */

declare(strict_types=1);

const ARBATT_LIVE_CHANNEL_RE = '/^[A-Za-z0-9_-]{1,64}$/';
const ARBATT_LIVE_PROGRAM = 'live_php';

/** Defaults of every parameter used here (mirrors config/param.json). */
function arbatt_defaults(): array
{
    return [
        'version' => '0.0.0',
        'ARBATT_LIVE_RELAY' => true,
        'ARBATT_LIVE_MAX_BYTES' => 65536,
        'ARBATT_LIVE_MAX_CHANNELS' => 50,
        'ARBATT_LIVE_KEEPALIVE_SECONDS' => 15,
        'ARBATT_LIVE_TOKEN' => '',
        // "" = <system temp dir>/arbatt-live ; a relative path is resolved
        // against the repository root (parent of the config dir).
        'ARBATT_LIVE_PHP_DATA_DIR' => '',
        'ARBATT_LIVE_PHP_STREAM_SECONDS' => 25,
        'ARBATT_LIVE_PHP_POLL_MS' => 250,
        // 2026-10-11 (v0.1.17): SSE comment padding sent after every flush.
        'ARBATT_LIVE_PHP_PAD_BYTES' => 4096,
        // PHP defaults to UTC while server.py logs in local time: align the
        // log stamps on the club's time zone.
        'ARBATT_LIVE_PHP_TIMEZONE' => 'Europe/Paris',
        'ARBATT_LOG_DIR' => 'logs',
        'ARBATT_LOG_TAGS' => ['DEBUG' => false],
    ];
}

/**
 * Read an environment parameter. Apache "SetEnv" values are not always
 * visible through getenv() under PHP-FPM (they arrive in $_SERVER), and after
 * the internal rewrite of www/api/.htaccess Apache renames them
 * REDIRECT_<name>: all three places are checked. Returns null if unset.
 */
function arbatt_env(string $name): ?string
{
    $v = getenv($name);
    if ($v !== false) {
        return $v;
    }
    foreach ([$name, 'REDIRECT_' . $name] as $k) {
        if (isset($_SERVER[$k]) && is_string($_SERVER[$k])) {
            return $_SERVER[$k];
        }
    }
    return null;
}

/** Coerce an environment string to the type of the default value. */
function arbatt_coerce(string $raw, $default)
{
    if (is_bool($default)) {
        return in_array(strtolower(trim($raw)), ['1', 'true', 'yes', 'on'], true);
    }
    if (is_int($default)) {
        return (int)$raw;
    }
    if (is_float($default)) {
        return (float)$raw;
    }
    if (is_array($default)) {
        $v = json_decode($raw, true);
        return is_array($v) ? $v : $default;
    }
    return $raw;
}

function arbatt_read_json(string $path): array
{
    if (!is_file($path)) {
        return [];
    }
    $v = json_decode((string)file_get_contents($path), true);
    return is_array($v) ? $v : [];
}

/**
 * Merged configuration: defaults -> param.json -> secret.json -> environment
 * (same order and env-override rule as arbatt_config.py).
 * Returns [config, configDir|null].
 */
function arbatt_load_config(): array
{
    $dir = arbatt_env('ARBATT_CONFIG_DIR');
    if ($dir === null || $dir === '') {
        $dir = __DIR__ . '/../../config';
    }
    $dir = is_dir($dir) ? (string)realpath($dir) : null;

    $config = arbatt_defaults();
    if ($dir !== null) {
        $config = array_merge($config,
            arbatt_read_json($dir . '/param.json'),
            arbatt_read_json($dir . '/secret.json'));
    }
    foreach ($config as $key => $default) {
        if ($key[0] === '_') {
            continue;
        }
        $env = arbatt_env((string)$key);
        if ($env !== null) {
            $config[$key] = arbatt_coerce($env, $default);
        }
    }
    return [$config, $dir];
}

/** Centralised logger: "STAMP [TAG] #NNNN message", errors mirrored to .err.txt. */
final class LiveLog
{
    private $logPath;
    private $errPath;
    private $tags;

    public function __construct(string $dir, array $tags)
    {
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $this->logPath = $dir . '/' . ARBATT_LIVE_PROGRAM . '.log';
        $this->errPath = $dir . '/' . ARBATT_LIVE_PROGRAM . '.err.txt';
        $this->tags = $tags;
    }

    public function log(string $tag, int $eid, string $message): void
    {
        $t = microtime(true);
        $stamp = date('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03d', ($t - floor($t)) * 1000);
        $line = sprintf("%s [%s] #%04d %s\n", $stamp, $tag, $eid, $message);
        if ($tag === 'ERROR' || $tag === 'WARN') {
            @file_put_contents($this->errPath, $line, FILE_APPEND | LOCK_EX);
        }
        if (($this->tags[$tag] ?? true) === false) {
            return;
        }
        @file_put_contents($this->logPath, $line, FILE_APPEND | LOCK_EX);
    }
}

/** Publication refused; carries the HTTP status. */
final class LiveError extends Exception
{
    public $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

/** File-backed store of the latest document of each channel. */
final class LiveStore
{
    private $dir;
    private $maxBytes;
    private $maxChannels;
    private $log;

    public function __construct(string $dir, int $maxBytes, int $maxChannels, LiveLog $log)
    {
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException('cannot create data dir ' . $dir);
        }
        $this->dir = $dir;
        $this->maxBytes = $maxBytes;
        $this->maxChannels = $maxChannels;
        $this->log = $log;
    }

    public function maxBytes(): int
    {
        return $this->maxBytes;
    }

    public static function validChannel(string $ch): bool
    {
        return (bool)preg_match(ARBATT_LIVE_CHANNEL_RE, $ch);
    }

    private function path(string $ch): string
    {
        return $this->dir . '/' . $ch . '.live';
    }

    /** Store a raw JSON body as the channel's latest document; return its seq. */
    public function publish(string $ch, string $body): int
    {
        if (!self::validChannel($ch)) {
            throw new LiveError(400, 'invalid channel id');
        }
        if (strlen($body) > $this->maxBytes) {
            throw new LiveError(413, sprintf('document too large (%d > %d bytes)',
                strlen($body), $this->maxBytes));
        }
        // Objects decoded as stdClass so that "{}" stays an object and a JSON
        // list is refused (same rule as the Python relay).
        $doc = json_decode($body);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new LiveError(400, 'invalid JSON: ' . json_last_error_msg());
        }
        if (!is_object($doc)) {
            throw new LiveError(400, 'the document must be a JSON object');
        }
        // Compact single-line JSON: REQUIRED by the SSE "data:" framing.
        $compact = json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $lock = fopen($this->dir . '/.lock', 'c');
        flock($lock, LOCK_EX);
        try {
            $current = $this->latest($ch);
            if ($current === null) {
                $this->evictIfNeeded();
                $this->log->log('LIVE', 6601, 'New live channel ' . $ch);
            }
            $seq = $current === null ? 1 : $current[0] + 1;
            // Atomic replace: readers never see a half-written file.
            $tmp = $this->path($ch) . '.' . getmypid() . '.tmp';
            file_put_contents($tmp, $seq . "\n" . $compact);
            rename($tmp, $this->path($ch));
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        $this->log->log('DEBUG', 6602, sprintf('Channel %s <- seq %d (%d bytes)',
            $ch, $seq, strlen($compact)));
        return $seq;
    }

    /** [seq, body] of the channel's latest document, or null. */
    public function latest(string $ch): ?array
    {
        $raw = @file_get_contents($this->path($ch));
        if ($raw === false) {
            return null;
        }
        $nl = strpos($raw, "\n");
        if ($nl === false) {
            return null;
        }
        return [(int)substr($raw, 0, $nl), substr($raw, $nl + 1)];
    }

    /** Drop the least recently updated channel(s). Caller holds the lock. */
    private function evictIfNeeded(): void
    {
        $files = glob($this->dir . '/*.live') ?: [];
        if ($this->maxChannels <= 0 || count($files) < $this->maxChannels) {
            return;
        }
        usort($files, function ($a, $b) {
            return filemtime($a) <=> filemtime($b);
        });
        while (count($files) >= $this->maxChannels) {
            $old = array_shift($files);
            @unlink($old);
            $this->log->log('WARN', 6603, sprintf('Live channel limit reached (%d): evicted %s',
                $this->maxChannels, basename($old, '.live')));
        }
    }
}

// ------------------------------------------------------------------ helpers
function arbatt_send(int $status, string $body, string $type = 'text/plain; charset=utf-8'): void
{
    http_response_code($status);
    header('Content-Type: ' . $type);
    header('Cache-Control: no-cache');
    echo $body;
}

function arbatt_send_json(int $status, $obj): void
{
    arbatt_send($status, json_encode($obj), 'application/json; charset=utf-8');
}

/**
 * SSE comment line of $bytes spaces (ignored by EventSource).
 *
 * 2026-10-11 (v0.1.17): measured on batt.club (OVH shared hosting) — the
 * hosting layer holds PHP output until about 4 KB have accumulated, whatever
 * flush() / X-Accel-Buffering / HTTP version: a small event published at 5 s
 * reached the overlay only at the end of the 25 s stream. Appending this
 * padding after EVERY event pushes it through immediately. 0 disables it
 * (hosts without such buffering). Single helper for the initial and the
 * per-event padding.
 */
function arbatt_sse_pad(int $bytes): string
{
    return $bytes > 0 ? ':' . str_repeat(' ', $bytes) . "\n\n" : '';
}

/** Serve one bounded SSE response (see the header comment). */
function arbatt_stream(LiveStore $store, string $ch, array $cfg, LiveLog $log): void
{
    $duration = max(1, (int)$cfg['ARBATT_LIVE_PHP_STREAM_SECONDS']);
    $pollUs = max(50, (int)$cfg['ARBATT_LIVE_PHP_POLL_MS']) * 1000;
    $keepalive = max(1, (int)$cfg['ARBATT_LIVE_KEEPALIVE_SECONDS']);
    $pad = arbatt_sse_pad(max(0, (int)$cfg['ARBATT_LIVE_PHP_PAD_BYTES']));

    @set_time_limit($duration + 15);
    ignore_user_abort(false);
    // Disable every output buffer / compression layer: events must leave now.
    @ini_set('zlib.output_compression', '0');
    @ini_set('output_buffering', '0');
    @ini_set('implicit_flush', '1');
    while (ob_get_level() > 0) {
        ob_end_flush();
    }
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');

    // "retry" = reconnection delay of EventSource (ms); the padding pushes
    // the headers through buffering proxies (was a fixed 2 KB comment, too
    // small for OVH — see arbatt_sse_pad()).
    echo "retry: 1000\n\n" . $pad;
    flush();

    $last = isset($_SERVER['HTTP_LAST_EVENT_ID']) ? (int)$_SERVER['HTTP_LAST_EVENT_ID'] : 0;
    $log->log('LIVE', 6610, sprintf('SSE subscriber on %s from %s (last id %d)',
        $ch, $_SERVER['REMOTE_ADDR'] ?? '?', $last));
    $deadline = microtime(true) + $duration;
    $nextPing = microtime(true) + $keepalive;
    while (microtime(true) < $deadline) {
        $doc = $store->latest($ch);
        // "!=" like the Python hub: a re-created channel restarts at 1.
        if ($doc !== null && $doc[0] !== $last) {
            $last = $doc[0];
            echo 'id: ' . $last . "\ndata: " . $doc[1] . "\n\n" . $pad;
            flush();
        } elseif (microtime(true) >= $nextPing) {
            echo ": keepalive\n\n";
            flush();
            $nextPing = microtime(true) + $keepalive;
        }
        if (connection_aborted()) {
            $log->log('LIVE', 6611, 'SSE subscriber left ' . $ch);
            return;
        }
        usleep($pollUs);
    }
}

// --------------------------------------------------------------------- main
function arbatt_main(): void
{
    [$cfg, $configDir] = arbatt_load_config();
    @date_default_timezone_set((string)$cfg['ARBATT_LIVE_PHP_TIMEZONE']);
    $root = $configDir !== null ? dirname($configDir) : null;

    $dataDir = (string)$cfg['ARBATT_LIVE_PHP_DATA_DIR'];
    if ($dataDir === '') {
        $dataDir = rtrim(sys_get_temp_dir(), '/') . '/arbatt-live';
    } elseif ($dataDir[0] !== '/' && $root !== null) {
        $dataDir = $root . '/' . $dataDir;
    }
    // Logs: <repo>/logs when the repository layout is known, else under the
    // data dir (copy deployments have no repository next to www/).
    $logDir = (string)$cfg['ARBATT_LOG_DIR'];
    if ($logDir === '' || $logDir[0] !== '/') {
        $logDir = ($root !== null ? $root : $dataDir) . '/' . ($logDir ?: 'logs');
    }
    $log = new LiveLog($logDir, is_array($cfg['ARBATT_LOG_TAGS']) ? $cfg['ARBATT_LOG_TAGS'] : []);

    if (!$cfg['ARBATT_LIVE_RELAY']) {
        arbatt_send(404, '404 Not Found');
        return;
    }

    try {
        $store = new LiveStore($dataDir, (int)$cfg['ARBATT_LIVE_MAX_BYTES'],
            (int)$cfg['ARBATT_LIVE_MAX_CHANNELS'], $log);
    } catch (RuntimeException $e) {
        $log->log('ERROR', 6620, 'Live relay unavailable: ' . $e->getMessage());
        arbatt_send_json(500, ['error' => 'relay storage unavailable']);
        return;
    }

    $path = (string)($_GET['path'] ?? '');
    $parts = array_values(array_filter(explode('/', $path), 'strlen'));
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $token = (string)$cfg['ARBATT_LIVE_TOKEN'];

    if ($method === 'GET' && $parts === ['_info']) {
        arbatt_send_json(200, ['relay' => true, 'tokenRequired' => $token !== '']);
        return;
    }
    if (!$parts || count($parts) > 2 || !LiveStore::validChannel($parts[0])) {
        arbatt_send(400, '400 Bad Request');
        return;
    }
    $ch = $parts[0];

    if ($method === 'GET') {
        if (count($parts) === 2) {
            if ($parts[1] !== 'events') {
                arbatt_send(404, '404 Not Found');
                return;
            }
            arbatt_stream($store, $ch, $cfg, $log);
            return;
        }
        $doc = $store->latest($ch);
        if ($doc === null) {
            arbatt_send(404, '404 Not Found');
            return;
        }
        arbatt_send(200, $doc[1], 'application/json; charset=utf-8');
        return;
    }

    if ($method !== 'POST') {
        arbatt_send(405, '405 Method Not Allowed');
        return;
    }
    if (count($parts) !== 1) {
        arbatt_send(400, '400 Bad Request');
        return;
    }
    if ($token !== '') {
        $given = (string)($_SERVER['HTTP_X_ARBATT_TOKEN'] ?? '');
        if (!hash_equals($token, $given)) {
            $log->log('SECURITY', 6630, sprintf('Live publish refused (bad token) on %s from %s',
                $ch, $_SERVER['REMOTE_ADDR'] ?? '?'));
            arbatt_send_json(403, ['error' => 'bad token']);
            return;
        }
    }
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length < 0 || $length > $store->maxBytes()) {
        arbatt_send_json(413, ['error' => 'document too large']);
        return;
    }
    try {
        $seq = $store->publish($ch, (string)file_get_contents('php://input'));
    } catch (LiveError $e) {
        $log->log('WARN', 6631, sprintf('Live publish rejected on %s: %s', $ch, $e->getMessage()));
        arbatt_send_json($e->status, ['error' => $e->getMessage()]);
        return;
    }
    arbatt_send_json(200, ['seq' => $seq]);
}

arbatt_main();
