/*
 * Pool de workers de compression, côté page.
 * - File d'attente dans l'ordre d'arrivée (celui de la liste, donc du ZIP), un travail par worker.
 * - Mémoire bornée : un budget de mégapixels pondérés en cours, en plus du nombre de workers.
 * - Annulation : en attente, le travail sort de la file ; en cours, son worker est arrêté.
 * - Délai maximal par travail, et recyclage : la mémoire d'un module WASM ne redescend jamais,
 *   seul terminate() la rend. Un worker inactif depuis 10 s est donc arrêté, et dispose() les arrête tous.
 */
import type { JobOptions } from './settings';
import type { Reply, Request } from './worker';

export type PoolReply = Reply | { id: string; press: 'cancelled' };

const RECYCLE_AFTER = 40;
const JOB_TIMEOUT = 90_000;
/** Sans travail depuis ce délai, un worker est arrêté : son tas WASM reste sinon à son plus haut. */
const IDLE_TIMEOUT = 10_000;
/** Poids supposé d'une image dont on ne connaît pas les dimensions (HEIC sous Chrome…). */
export const UNKNOWN_MPX = 24;
const MODULE_MISSING = 'Module de compression non chargé : rechargez la page';

interface Job {
  id: string;
  file: File;
  options: JobOptions;
  /** Mégapixels pondérés, fixés par la page (voir defaultBudget). */
  cost: number;
  onStart?: () => void;
  resolve: (reply: PoolReply) => void;
}

interface Slot {
  worker: Worker;
  done: number;
  job: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
}

const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });

/** Mémoire en Go. Firefox et Safari ne la donnent pas : 4 Go supposés pour 4 cœurs ou moins, 8 sinon. */
function deviceMemory(): number {
  return nav?.deviceMemory ?? ((nav?.hardwareConcurrency || 4) <= 4 ? 4 : 8);
}

/** Un cœur reste libre pour la page ; 3 workers au plus ; 2 si la machine a 4 Go ou moins. */
export function defaultPoolSize(): number {
  const cores = nav?.hardwareConcurrency || 4;
  return Math.max(1, Math.min(cores - 2, deviceMemory() <= 4 ? 2 : 3));
}

/**
 * Mégapixels pondérés en cours à la fois. Une photo de 24 Mpx en cours occupe 150 à 180 Mo (décodage,
 * réduction, pixels, tas WASM) : 75 Mpx ≈ 500 Mo, soit trois photos de 24 Mpx ou une de 45 Mpx et une de 24.
 * La page pondère le coût d'un travail (pixels de sortie plus lourds sans limite de taille).
 */
export function defaultBudget(): number {
  return deviceMemory() <= 4 ? 40 : 75;
}

export class CompressPool {
  private queue: Job[] = [];
  private slots: Slot[] = [];
  /** Workers morts au démarrage d'affilée : à 3, le module ne se charge pas, on abandonne. */
  private deadStreak = 0;

  constructor(
    private readonly size = defaultPoolSize(),
    private readonly budget = defaultBudget(),
  ) {}

  run(id: string, file: File, options: JobOptions, cost = UNKNOWN_MPX, onStart?: () => void): Promise<PoolReply> {
    return new Promise((resolve) => {
      this.queue.push({ id, file, options, cost, onStart, resolve });
      this.pump();
    });
  }

  cancel(id: string): void {
    const index = this.queue.findIndex((j) => j.id === id);
    if (index !== -1) {
      this.queue.splice(index, 1)[0].resolve({ id, press: 'cancelled' });
      return;
    }
    const slot = this.slots.find((s) => s.job?.id === id);
    if (slot) this.kill(slot, null);
  }

  cancelAll(): void {
    // Nouveau départ : un module absent (mise à jour, réseau) est retenté au prochain travail.
    this.deadStreak = 0;
    for (const job of this.queue.splice(0)) job.resolve({ id: job.id, press: 'cancelled' });
    for (const slot of [...this.slots]) if (slot.job) this.kill(slot, null);
  }

  /** Annule tout et arrête tous les workers, inactifs compris : leur mémoire est rendue tout de suite. */
  dispose(): void {
    this.cancelAll();
    for (const slot of [...this.slots]) this.remove(slot);
  }

  private get running(): number {
    return this.slots.reduce((sum, s) => sum + (s.job ? s.job.cost : 0), 0);
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'compression' });
    const slot: Slot = { worker, done: 0, job: null, timer: null, idle: null };
    worker.onmessage = ({ data }: MessageEvent<Reply>) => this.finish(slot, data);
    // Module introuvable, mémoire épuisée, plantage d'un codec : le worker est remplacé.
    worker.onerror = (event) => {
      event.preventDefault();
      if (slot.done === 0) this.deadStreak++;
      this.kill(slot, this.deadStreak >= 3 ? MODULE_MISSING : 'Compression impossible sur ce poste');
    };
    this.slots.push(slot);
    return slot;
  }

  private pump(): void {
    if (this.deadStreak >= 3) {
      for (const job of this.queue.splice(0)) job.resolve({ id: job.id, press: 'fail', note: MODULE_MISSING });
      return;
    }
    while (this.queue.length > 0) {
      const busy = this.slots.some((s) => s.job);
      const next = this.queue[0];
      // Dans l'ordre : une grande image attend que la mémoire se libère, sans se faire doubler.
      if (busy && this.running + next.cost > this.budget) return;
      const slot = this.slots.find((s) => !s.job) ?? (this.slots.length < this.size ? this.spawn() : null);
      if (!slot) return;
      this.queue.shift();
      if (slot.idle) clearTimeout(slot.idle);
      slot.idle = null;
      slot.job = next;
      slot.timer = setTimeout(() => this.kill(slot, 'Compression trop longue sur ce poste'), JOB_TIMEOUT);
      next.onStart?.();
      slot.worker.postMessage({ id: next.id, file: next.file, options: next.options } satisfies Request);
    }
  }

  private finish(slot: Slot, reply: Reply): void {
    const job = slot.job;
    if (!job || job.id !== reply.id) return;
    if (slot.timer) clearTimeout(slot.timer);
    slot.job = null;
    slot.timer = null;
    this.deadStreak = 0;
    job.resolve(reply);
    // Codec planté : son module en cache a avorté et la mémoire de l'appel n'est jamais rendue.
    if (reply.fatal || ++slot.done >= RECYCLE_AFTER) this.remove(slot);
    this.pump();
    if (!slot.job && this.slots.includes(slot)) {
      slot.idle = setTimeout(() => {
        slot.idle = null;
        if (!slot.job) this.remove(slot);
      }, IDLE_TIMEOUT);
    }
  }

  /** Arrête le worker ; le travail en cours finit en échec (note) ou annulé (null). */
  private kill(slot: Slot, note: string | null): void {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    this.remove(slot);
    if (job) job.resolve(note === null ? { id: job.id, press: 'cancelled' } : { id: job.id, press: 'fail', note });
    this.pump();
  }

  private remove(slot: Slot): void {
    if (slot.idle) clearTimeout(slot.idle);
    slot.idle = null;
    slot.worker.terminate();
    this.slots = this.slots.filter((s) => s !== slot);
  }
}
