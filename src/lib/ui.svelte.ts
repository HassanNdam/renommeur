/*
 * État d'interface seulement : filtre, édition en cours, feuille mobile, toast.
 * Aucun lien avec l'API ni avec les files de lecture et de nommage (store.svelte.ts).
 */

export type Filter = 'all' | 'todo' | 'done' | 'edited' | 'error' | 'dup' | 'squeezed' | 'optimal' | 'unsqueezed';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
  actions: ToastAction[];
  persist: boolean;
}

export const ui = $state({
  filter: 'all' as Filter,
  /** Nom en cours d'édition, un seul à la fois. */
  editingId: null as string | null,
  /** Ligne visée par la feuille d'actions mobile. */
  sheetFor: null as string | null,
  toast: null as Toast | null,
});

export const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let remaining = 0;
let startedAt = 0;
let paused = false;

export function showToast(t: { text: string; tone?: 'info' | 'error'; actions?: ToastAction[]; persist?: boolean }): void {
  clearTimeout(timer);
  paused = false;
  ui.toast = { id: ++sequence, text: t.text, tone: t.tone ?? 'info', actions: t.actions ?? [], persist: t.persist ?? false };
  if (!ui.toast.persist) arm(ui.toast.actions.length ? 8000 : 6000);
}

function arm(ms: number): void {
  remaining = ms;
  startedAt = Date.now();
  timer = setTimeout(() => (ui.toast = null), ms);
}

/** Le toast ne part pas pendant qu'on le survole ou qu'il a le focus. */
export function pauseToast(): void {
  if (!ui.toast || ui.toast.persist || paused) return;
  paused = true;
  clearTimeout(timer);
  remaining -= Date.now() - startedAt;
}

export function resumeToast(): void {
  if (!ui.toast || ui.toast.persist || !paused) return;
  paused = false;
  arm(Math.max(remaining, 2000));
}

export function closeToast(): void {
  clearTimeout(timer);
  ui.toast = null;
}

/** Ligne voisine d'une ligne de la liste : point de chute du focus si celle-ci disparaît. */
export function rowAround(id: string): HTMLElement | null {
  const li = document.querySelector(`.rows li[data-id="${id}"]`);
  return (li?.nextElementSibling ?? li?.previousElementSibling ?? null) as HTMLElement | null;
}

/** Donne le focus à `selector` dans la ligne, sinon au lien de la vue vide, sinon au titre de la liste. */
export function focusRow(li: HTMLElement | null, selector: string): void {
  (
    li?.querySelector<HTMLElement>(selector) ??
    document.querySelector<HTMLElement>('.rows .none button') ??
    document.getElementById('files-title')
  )?.focus();
}
