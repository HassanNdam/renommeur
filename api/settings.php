<?php

declare(strict_types=1);

/* Réglages publics de l'outil, lus par l'interface au chargement. */

require __DIR__ . '/bootstrap.php';

require_method('GET');
$config = config();

json_response([
    'version' => APP_VERSION,
    'model' => $config['model'],
    'batchSize' => $config['batch_size'],
    'mock' => (bool) $config['mock'],
    'keyConfigured' => $config['api_key'] !== '',
]);
