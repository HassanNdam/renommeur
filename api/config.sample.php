<?php

/*
 * Copiez ce fichier en config.php (même dossier) et complétez-le.
 * config.php n'est jamais livré par le paquet de mise à jour : il reste sur le serveur.
 */

return [
    // Clé de l'API Claude, créée sur https://console.anthropic.com (Settings → API keys).
    'api_key' => '',

    // Seulement pour une clé d'utilisateur (sk-ant-usr…), valable sur plusieurs espaces
    // de travail : identifiant de celui à utiliser (wrkspc_…). Vide pour une clé
    // créée dans un espace de travail, le cas conseillé.
    'workspace_id' => '',

    // Empreinte du mot de passe commun de l'équipe. Pour la générer :
    //   php -r "echo password_hash('le-mot-de-passe', PASSWORD_DEFAULT), PHP_EOL;"
    'password_hash' => '',

    // Modèle utilisé pour nommer les fichiers (coûts mesurés sur un lot réel, le 23/10/2026) :
    //   claude-sonnet-5-5 conseillé : lit le texte des images, ~2,20 $ les 1 000 images
    //   claude-opus-5-5   qualité équivalente, plus lent, ~4,40 $ les 1 000 images
    //   claude-haiku-5-5  noms plus génériques à relire, ~0,20 $ les 1 000 images
    'model' => 'claude-sonnet-5-5',

    // Effort de réflexion du modèle : low suffit pour nommer des fichiers.
    'effort' => 'low',

    // Fichiers envoyés au modèle par requête (1 à 12).
    'batch_size' => 8,

    // Durée d'une session avant de devoir retaper le mot de passe.
    'session_hours' => 12,

    // true : noms factices sans appeler l'API (démonstration, développement).
    'mock' => false,
];
