<?php

declare(strict_types=1);

/*
 * Socle commun des points d'entrée de l'API : configuration, session,
 * réponses JSON et limitation des tentatives de connexion.
 */

const APP_VERSION = '0.1.0';

require __DIR__ . '/vendor/autoload.php';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

/** Valeurs par défaut, surchargées par api/config.php. */
function config_defaults(): array
{
    return [
        'api_key' => '',
        'workspace_id' => '',
        'password_hash' => '',
        'model' => 'claude-sonnet-5-5',
        'effort' => 'low',
        'batch_size' => 8,
        'session_hours' => 12,
        'mock' => false,
    ];
}

function config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $file = __DIR__ . '/config.php';
    if (!is_file($file)) {
        json_error(500, 'config_missing', 'Le fichier api/config.php est absent : copiez config.sample.php en config.php et complétez-le.');
    }
    $loaded = require $file;
    $config = array_replace(config_defaults(), is_array($loaded) ? $loaded : []);
    $config['batch_size'] = max(1, min(12, (int) $config['batch_size']));
    return $config;
}

function json_response(array $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(int $status, string $code, string $message, array $extra = []): never
{
    json_response(['error' => ['code' => $code, 'message' => $message] + $extra], $status);
}

function require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== $method) {
        header('Allow: ' . $method);
        json_error(405, 'method_not_allowed', 'Méthode non autorisée.');
    }
}

/**
 * Lit un corps JSON. Exiger application/json empêche un formulaire d'un autre
 * site de déclencher l'action sans contrôle préalable du navigateur.
 */
function read_json_body(int $maxBytes): array
{
    require_method('POST');
    $type = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
    if (!str_starts_with($type, 'application/json')) {
        json_error(415, 'bad_content_type', 'Le corps de la requête doit être du JSON.');
    }
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) {
        json_error(413, 'too_large', 'Requête trop volumineuse.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        json_error(413, 'too_large', 'Requête trop volumineuse.');
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        json_error(400, 'bad_json', 'JSON invalide.');
    }
    return $data;
}

/** Texte UTF-8 propre : sans caractères de contrôle, tronqué à $max caractères. */
function clean_text(string $text, int $max): string
{
    $text = mb_scrub($text, 'UTF-8');
    $text = preg_replace('/[^\P{C}\n\t]+/u', ' ', $text) ?? '';
    return trim(mb_substr($text, 0, $max));
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = ($_SERVER['HTTPS'] ?? '') === 'on'
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'
        || (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
    // Le cookie ne vaut que pour le dossier de l'application.
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api/x.php', 2)), '/') . '/';
    session_name('pixim_renommeur');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => $base,
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) (config()['session_hours'] * 3600));
    session_start();
}

function is_authenticated(): bool
{
    // Pas de cookie, pas de session à ouvrir : un simple visiteur n'en reçoit pas.
    if (session_status() !== PHP_SESSION_ACTIVE && !isset($_COOKIE['pixim_renommeur'])) {
        return false;
    }
    start_session();
    $at = $_SESSION['auth_at'] ?? null;
    if (!is_int($at)) {
        return false;
    }
    if (time() - $at > config()['session_hours'] * 3600) {
        $_SESSION = [];
        return false;
    }
    return true;
}

function require_auth(): void
{
    if (!is_authenticated()) {
        json_error(401, 'unauthenticated', 'Session expirée : reconnectez-vous.');
    }
    // Libère le verrou de session : les lots peuvent alors partir en parallèle.
    session_write_close();
}

/** Dossier d'écriture de l'application (journal, limitation des tentatives). */
function var_dir(): string
{
    $dir = __DIR__ . '/var';
    if (!is_dir($dir)) {
        @mkdir($dir, 0750, true);
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

/**
 * Au plus 8 mots de passe erronés par adresse IP et par quart d'heure.
 * Retourne le nombre de secondes à attendre, 0 si la tentative est permise.
 */
function login_wait_seconds(string $ip, bool $recordFailure = false): int
{
    $window = 900;
    $max = 8;
    $file = var_dir() . '/login-' . hash('sha256', $ip) . '.json';
    $now = time();
    $attempts = is_file($file) ? (json_decode((string) file_get_contents($file), true) ?: []) : [];
    $attempts = array_values(array_filter($attempts, fn ($t) => is_int($t) && $t > $now - $window));
    if ($recordFailure) {
        $attempts[] = $now;
        @file_put_contents($file, json_encode($attempts), LOCK_EX);
    }
    return count($attempts) >= $max ? max(1, $attempts[0] + $window - $now) : 0;
}

/** Une ligne par appel au modèle, pour suivre la consommation. */
function log_usage(string $model, int $items, ?object $usage): void
{
    $line = implode(';', [
        date('c'),
        $model,
        $items,
        $usage->inputTokens ?? 0,
        $usage->outputTokens ?? 0,
    ]) . "\n";
    @file_put_contents(var_dir() . '/usage.csv', $line, FILE_APPEND | LOCK_EX);
}

function anthropic_client(): Anthropic\Client
{
    return new Anthropic\Client(
        apiKey: config()['api_key'],
        requestOptions: ['maxRetries' => 1],
    );
}

/**
 * Espace de travail à indiquer à chaque appel. Inutile avec une clé créée dans
 * un espace de travail ; obligatoire avec une clé d'utilisateur (sk-ant-usr…).
 */
function workspace_args(): array
{
    $id = trim((string) config()['workspace_id']);
    return $id === '' ? [] : ['workspaceID' => $id];
}

/** Message lisible pour une erreur renvoyée par l'API Claude. */
function api_error_message(Anthropic\Core\Exceptions\APIStatusException $e): string
{
    $detail = (string) ($e->body['error']['message'] ?? '');
    return match (true) {
        str_contains($detail, 'not scoped to a workspace') =>
            'Cette clé n’est rattachée à aucun espace de travail : renseignez workspace_id dans api/config.php, ou utilisez une clé créée dans un espace de travail.',
        str_contains($detail, 'workspace') =>
            'Espace de travail refusé par Anthropic : vérifiez workspace_id dans api/config.php.',
        $e->status === 401 => 'La clé API Claude est refusée (api/config.php).',
        $e->status === 403 => 'La clé API n’a pas accès à ce modèle ou à cet espace de travail.',
        $e->status === 404 => 'Le modèle « ' . config()['model'] . ' » est inconnu.',
        $e->status === 429 => 'Trop de demandes envoyées à Claude en même temps.',
        $e->status >= 500 => 'Claude est momentanément surchargé.',
        default => 'L’API Claude a répondu une erreur ' . $e->status . ($detail !== '' ? ' : ' . $detail : '.'),
    };
}
