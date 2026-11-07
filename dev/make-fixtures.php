<?php

// Fabrique un lot de fichiers d'essai dans dev/fixtures : php dev/make-fixtures.php

declare(strict_types=1);

$dir = __DIR__ . '/fixtures';
@mkdir($dir, 0777, true);

function picture(string $path, int $w, int $h, array $bg, array $shape, string $label, string $type = 'jpg'): void
{
    $img = imagecreatetruecolor($w, $h);
    imagefill($img, 0, 0, imagecolorallocate($img, ...$bg));
    $c = imagecolorallocate($img, ...$shape);
    imagefilledellipse($img, (int) ($w * 0.62), (int) ($h * 0.55), (int) ($w * 0.5), (int) ($h * 0.5), $c);
    imagefilledrectangle($img, (int) ($w * 0.08), (int) ($h * 0.1), (int) ($w * 0.3), (int) ($h * 0.9), imagecolorallocate($img, 20, 20, 20));
    imagestring($img, 5, 20, $h - 30, $label, imagecolorallocate($img, 255, 255, 255));
    $type === 'png' ? imagepng($img, $path) : imagejpeg($img, $path, 88);
}

picture("$dir/IMG_2034.JPG", 2400, 1600, [214, 170, 110], [150, 80, 30], 'vitrine');
picture("$dir/IMG_2035.JPG", 1600, 2400, [240, 230, 210], [190, 120, 40], 'croissants');
picture("$dir/DSC00012.jpeg", 2000, 1333, [90, 120, 160], [230, 230, 240], 'atelier');
picture("$dir/Photo équipe 2024 (copie).png", 1200, 800, [244, 243, 239], [196, 40, 28], 'equipe', 'png');
picture("$dir/vitrine.jpg", 800, 600, [200, 200, 200], [60, 60, 60], 'doublon');

// PDF d'une page avec du texte.
$text = 'Carte des patisseries - Boulangerie Martin Annecy - Tartes, eclairs, macarons';
$stream = "BT /F1 18 Tf 50 750 Td ($text) Tj ET";
$objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' . strlen($stream) . " >>\nstream\n$stream\nendstream",
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
$pdf = "%PDF-1.4\n";
$offsets = [];
foreach ($objects as $i => $object) {
    $offsets[] = strlen($pdf);
    $pdf .= ($i + 1) . " 0 obj\n$object\nendobj\n";
}
$xref = strlen($pdf);
$pdf .= "xref\n0 " . (count($objects) + 1) . "\n0000000000 65535 f \n";
foreach ($offsets as $offset) {
    $pdf .= sprintf("%010d 00000 n \n", $offset);
}
$pdf .= "trailer\n<< /Size " . (count($objects) + 1) . " /Root 1 0 R >>\nstartxref\n$xref\n%%EOF";
file_put_contents("$dir/Document numérisé 3.pdf", $pdf);

// Word minimal.
$zip = new ZipArchive();
$zip->open("$dir/devis final V2.docx", ZipArchive::CREATE | ZipArchive::OVERWRITE);
$zip->addFromString('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
$zip->addFromString('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Devis rénovation vitrine</dc:title></cp:coreProperties>');
$zip->addFromString('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Devis pour la rénovation de la vitrine &amp; de l’enseigne</w:t></w:r></w:p><w:p><w:r><w:t>Boulangerie Martin, Annecy</w:t></w:r></w:p></w:body></w:document>');
$zip->close();

// Excel minimal.
$zip = new ZipArchive();
$zip->open("$dir/Classeur1.xlsx", ZipArchive::CREATE | ZipArchive::OVERWRITE);
$zip->addFromString('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="x"><sheets><sheet name="Tarifs 2026" sheetId="1"/><sheet name="Allergènes" sheetId="2"/></sheets></workbook>');
$zip->addFromString('xl/sharedStrings.xml', '<?xml version="1.0"?><sst xmlns="x"><si><t>Produit</t></si><si><t>Prix TTC</t></si><si><t>Baguette tradition</t></si><si><t>Croissant pur beurre</t></si></sst>');
$zip->close();

file_put_contents("$dir/notes.txt", "Idées pour la page À propos : histoire de la boulangerie depuis 1987, le fournil, l'équipe.");
file_put_contents("$dir/IMG_4410.HEIC", random_bytes(2048));

echo 'Fichiers créés dans ' . $dir . PHP_EOL;
