<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

require_method('GET');
$config = config();

if (!is_authenticated()) {
    json_response(['authenticated' => false]);
}

json_response([
    'authenticated' => true,
    'settings' => [
        'version' => APP_VERSION,
        'model' => $config['model'],
        'batchSize' => $config['batch_size'],
        'mock' => (bool) $config['mock'],
        'keyConfigured' => $config['api_key'] !== '',
    ],
]);
