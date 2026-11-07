<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$body = read_json_body(4096);
$config = config();
$ip = $_SERVER['REMOTE_ADDR'] ?? 'inconnue';

if ($config['password_hash'] === '') {
    json_error(503, 'no_password', 'Aucun mot de passe n’est configuré (password_hash dans api/config.php).');
}

$wait = login_wait_seconds($ip);
if ($wait > 0) {
    header('Retry-After: ' . $wait);
    json_error(429, 'too_many_attempts', 'Trop de tentatives. Réessayez dans ' . (int) ceil($wait / 60) . ' min.');
}

$password = (string) ($body['password'] ?? '');
if (!password_verify($password, $config['password_hash'])) {
    login_wait_seconds($ip, true);
    usleep(600_000);
    json_error(401, 'bad_password', 'Mot de passe incorrect.');
}

start_session();
session_regenerate_id(true);
$_SESSION['auth_at'] = time();

json_response(['ok' => true]);
