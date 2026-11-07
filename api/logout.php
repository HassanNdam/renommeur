<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

read_json_body(1024);
start_session();
$_SESSION = [];
session_destroy();

json_response(['ok' => true]);
