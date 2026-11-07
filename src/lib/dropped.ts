/**
 * Fichiers d'un glisser-déposer, dossiers et sous-dossiers compris.
 * Les entrées doivent être lues tout de suite : le DataTransfer se vide après l'événement.
 */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = [...dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return [...dataTransfer.files];
  const files: File[] = [];
  await Promise.all(entries.map((entry) => walk(entry, files)));
  return files;
}

/**
 * Chemin relatif d'un fichier déposé (« images/blog/x.jpg ») : en « Compresser », le ZIP garde
 * l'arborescence, pour remplacer le dossier en place sur le serveur.
 */
const relativePath = new WeakMap<File, string>();

/** Chemin relatif du fichier s'il vient d'un dossier déposé, sinon son nom. */
export const sourcePath = (file: File) => relativePath.get(file) ?? file.name;

async function walk(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    if (entry.fullPath.length > 1) relativePath.set(file, entry.fullPath.slice(1));
    out.push(file);
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries rend les entrées par paquets de 100 : on lit jusqu'à épuisement.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    await Promise.all(batch.map((child) => walk(child, out)));
  }
}
