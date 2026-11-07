// pdf.js est lourd : ce module n'est chargé qu'au premier PDF déposé.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Rend la première page et lit le texte des trois premières. */
export async function firstPageAndText(
  file: File,
  maxSide: number,
): Promise<{ canvas: HTMLCanvasElement; text: string }> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxSide / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    // L'intention « print » rend d'un trait, sans requestAnimationFrame :
    // sinon le rendu reste suspendu tant que l'onglet est en arrière-plan.
    await page.render({ canvas, viewport, intent: 'print' }).promise;

    const chunks: string[] = [];
    const meta = await pdf.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title;
    if (title) chunks.push(`Titre : ${title}`);
    for (let n = 1; n <= Math.min(3, pdf.numPages); n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      chunks.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return { canvas, text: chunks.join('\n') };
  } finally {
    await task.destroy();
  }
}
