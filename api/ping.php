<?php

declare(strict_types=1);

/*
 * Vérifie que l'hébergement joint l'API Claude avec la clé configurée.
 * Ne consomme aucun jeton : interroge seulement la fiche du modèle.
 */

require __DIR__ . '/bootstrap.php';

use Anthropic\Core\Exceptions\APIConnectionException;
use Anthropic\Core\Exceptions\APIStatusException;

read_json_body(1024);
$config = config();

if ($config['mock']) {
    json_response(['ok' => true, 'mock' => true]);
}
if ($config['api_key'] === '') {
    json_response(['ok' => false, 'reason' => 'Aucune clé API n’est configurée dans api/config.php.']);
}

try {
    $model = anthropic_client()->models->retrieve($config['model'], ...workspace_args());
    json_response(['ok' => true, 'model' => $model->displayName]);
} catch (APIStatusException $e) {
    json_response(['ok' => false, 'reason' => api_error_message($e)]);
} catch (APIConnectionException) {
    json_response(['ok' => false, 'reason' => 'Le serveur ne parvient pas à joindre api.anthropic.com.']);
}
