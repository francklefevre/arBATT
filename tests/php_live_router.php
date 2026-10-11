<?php
/*
 * arBATT - Table tennis club referee companion (PWA)
 *
 * Free software developed by Franck LEFEVRE for K1 ( https://k1info.com ),
 * with the help of his team of kind and playful robots. Please use the
 * enormous power of this software to do good things for things and people,
 * always making sure it harms nothing and no one.
 *
 * 2026-10-06 (v0.1.13): TEST-ONLY router for PHP's built-in web server, which
 * ignores .htaccess. It reproduces the rewrite of www/api/.htaccess
 * (api/live/<path> -> live.php?path=<path>) and serves the rest statically:
 *
 *   php -S 127.0.0.1:8097 -t www tests/php_live_router.php
 */
$uri = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('#^/api/live/(.*)$#', $uri, $m)) {
    $_GET['path'] = $m[1];
    // Simulate Apache's internal-redirect renaming of SetEnv variables
    // (REDIRECT_<name>) when the test sets ARBATT_TEST_REDIRECT_TOKEN.
    if (getenv('ARBATT_TEST_REDIRECT_TOKEN') !== false) {
        $_SERVER['REDIRECT_ARBATT_LIVE_TOKEN'] = getenv('ARBATT_TEST_REDIRECT_TOKEN');
    }
    require __DIR__ . '/../www/api/live.php';
    return true;
}
return false; // static file from the docroot
