<script lang="ts">
  import { tick, untrack } from 'svelte';
  import {
    app,
    clearAll,
    holdRestart,
    nameAll,
    nameParts,
    outgoing,
    view,
    whenSettled,
    zipSignal,
    type Entry,
    type Press,
  } from '../lib/store.svelte';
  import { archiveName, downloadArchive, downloadCsv, type Outgoing, type ReportRow } from '../lib/download';
  import { sourcePath } from '../lib/dropped';
  import { withExt } from '../lib/slug';
  import { formatGain, formatSize } from '../lib/format';
  import { isMac, showToast } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let { onshowerrors, onshowfailed }: { onshowerrors: () => void; onshowfailed: () => void } = $props();

  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const c = $derived(view.counts);
  const mode = $derived(app.mode);
  const s = $derived(view.squeeze);
  /** Images encore à compresser (en attente ou en cours). */
  const pressing = $derived(mode === 'rename' ? 0 : s.wait + s.run);
  const settledImages = $derived(s.images - s.wait - s.run);
  const gainReady = $derived(mode !== 'rename' && s.images > 0 && pressing === 0 && s.done > 0);
  const retrying = $derived(app.entries.filter((e) => e.status === 'ready' && e.attempts > 0).length);
  const running = $derived(c.pending + retrying);
  const fresh = $derived(c.ready - retrying);
  /* nameAll() met en file les prêts, les fichiers encore en lecture (autoQueue) ET les erreurs :
     le libellé compte donc les trois. */
  const toName = $derived(fresh > 0 ? fresh + c.reading + c.error : 0);
  const showName = $derived(mode !== 'compress' && toName > 0 && !app.apiProblem);
  const blocked = $derived(mode !== 'compress' && (toName > 0 || c.error > 0) && !!app.apiProblem);
  const settled = $derived(fresh === 0 && running === 0 && c.reading === 0);
  /* Compresser : le ZIP est l'action principale dès le premier fichier ; il attend chaque compression
     dans le flux. Les deux : dès que le nommage est réglé, même si la compression continue. */
  const zipPrimary = $derived(mode === 'compress' ? c.total > 0 : c.done > 0 && settled && !showName);
  const zipCount = $derived(mode === 'compress' ? c.total : c.done);
  const showZip = $derived(zipCount > 0);
  /* Le CSV donne les poids finaux : il attend la fin des compressions (absent, jamais grisé). */
  const showCsv = $derived(mode === 'compress' ? c.total > 0 && pressing === 0 : c.done > 0 && pressing === 0);
  const zipName = $derived(archiveName(mode === 'compress' ? 'images compressées' : app.context, 'zip'));
  const showRetry = $derived(mode !== 'compress' && c.error > 0 && fresh === 0 && !app.apiProblem);
  const ratio = (n: number) => (c.total ? n / c.total : 0);
  const allFiles = $derived(c.total > 1 ? `les ${c.total} fichiers` : 'le fichier');
  const shortcut = isMac ? 'Meta+Enter' : 'Control+Enter';
  const nameTitle = $derived.by(() => {
    if (!c.error && !c.reading) return undefined;
    const parts = [plural(fresh, 'prêt', 'prêts')];
    if (c.reading) parts.push(`${c.reading} en lecture`);
    if (c.error) parts.push(`${c.error} en erreur`);
    return `${parts.join(', ')} : nommés ensemble`;
  });

  let zipping = $state(false);
  let confirmClear = $state(false);
  let announce = $state('');
  let sheet: HTMLElement;
  let primary = $state<HTMLButtonElement | null>(null);
  let innerHeight = $state(64);

  /* Hauteur réelle de la barre (elle passe sur deux lignes en tablette) : réserve en bas de
     page, défilement au clavier et toasts s'y calent. */
  $effect(() => {
    document.documentElement.style.setProperty('--bar-h', `${innerHeight + 4}px`);
    return () => document.documentElement.style.removeProperty('--bar-h');
  });

  /** Lignes qui partent : toutes en « Compresser », les nommées sinon. */
  const leaving = (): Entry[] => (mode === 'compress' ? app.entries : app.entries.filter((e) => e.status === 'done'));

  /**
   * Nom et contenu lus au moment d'écrire chaque fichier, après sa compression. Les lignes sont
   * figées au clic (traitement bloqué pendant l'écriture) : une ligne repassée en file garde le nom
   * qu'elle avait, et un nom déjà écrit n'est jamais repris, même libéré entre-temps.
   */
  function outgoingItems(): Outgoing[] {
    const written = new Set<string>();
    return leaving().map((e) => {
      const id = e.id;
      const slug = e.slug;
      return {
        lastModified: e.file.lastModified,
        resolve: async () => {
          await whenSettled(id);
          const cur = app.entries.find((x) => x.id === id);
          if (!cur) return null; // retirée de la liste
          const p = nameParts(cur) ?? { base: slug || 'fichier', ext: cur.output?.ext ?? cur.ext };
          let name = view.fileNames.get(id) ?? withExt(p.base, p.ext);
          for (let n = 2; written.has(name.toLowerCase()); n++) name = withExt(`${p.base}-${n}`, p.ext);
          written.add(name.toLowerCase());
          return { name, blob: outgoing(cur) };
        },
      };
    });
  }

  const TREATMENT: Record<Press, string> = {
    wait: 'En attente',
    run: 'En cours',
    done: 'Compressée',
    same: 'Déjà optimisée',
    fail: 'Non compressée',
    skip: 'Tel quel',
  };

  function reportRows(): ReportRow[] {
    return leaving().map((e) => {
      const out = e.output;
      const note = e.pressNote && (e.press === 'fail' || (e.press === 'done' && out?.ext)) ? ` : ${e.pressNote}` : '';
      return {
        originalName: sourcePath(e.file),
        name: view.fileNames.get(e.id) ?? e.file.name,
        alt: e.alt,
        before: e.file.size,
        after: outgoing(e).size,
        dims: out && (e.press === 'done' || e.press === 'same') ? `${out.width} × ${out.height}` : '',
        treatment: TREATMENT[e.press] + note,
      };
    });
  }

  function csv() {
    downloadCsv(reportRows(), mode, archiveName(mode === 'compress' ? 'images compressées' : app.context, 'csv'));
  }

  async function zip() {
    if (zipping) return;
    zipping = true;
    // Un réglage changé pendant l'écriture ne relance la compression qu'une fois le ZIP fini ;
    // une relance encore dans son délai part avant, et le traitement reste figé jusqu'à la fin.
    const release = holdRestart();
    const signal = zipSignal();
    try {
      await downloadArchive(outgoingItems(), zipName, signal);
    } catch {
      if (signal.aborted) return; // « Tout retirer » : rien à enregistrer, rien à signaler
      showToast({
        text: 'Le ZIP n’a pas pu être créé. Réessayez ; si l’erreur revient, téléchargez le CSV et les fichiers un par un.',
        tone: 'error',
        persist: true,
        actions: [
          { label: 'Réessayer', run: zip },
          { label: 'Télécharger le CSV', run: csv },
        ],
      });
    } finally {
      release();
      zipping = false;
    }
  }

  function showWhy() {
    document.getElementById('api-alert')?.focus();
  }

  /** Ctrl/⌘ + Entrée : valide la saisie en cours (le champ perd le focus) puis déclenche le bouton rouge. */
  function onWindowKey(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || !primary) return;
    event.preventDefault();
    primary.focus();
    primary.click();
  }

  /* Feuille mobile : le focus entre dans la feuille à l'ouverture et suit chaque bascule. */
  async function setConfirm(value: boolean) {
    confirmClear = value;
    await tick();
    sheet.querySelector<HTMLElement>(value ? '[data-cancel]' : '[data-clear]')?.focus();
  }

  function onSheetToggle(event: Event) {
    const state = (event as ToggleEvent).newState;
    if (state === 'open') sheet.querySelector('button')?.focus();
    else confirmClear = false;
  }

  async function clearFromSheet() {
    sheet.hidePopover();
    clearAll();
    await tick();
    document.querySelector<HTMLElement>('.drop')?.focus();
  }

  /* Compresser : annonces au début et à la fin seulement ; « Les deux » reste silencieux. */
  let wasPressing = untrack(() => pressing > 0);
  $effect(() => {
    const now = pressing > 0;
    if (now === wasPressing) return;
    wasPressing = now;
    if (mode !== 'compress') return;
    untrack(() => {
      announce = now
        ? 'Compression lancée.'
        : gainReady
          ? `Compression terminée : ${formatSize(s.after)} au lieu de ${formatSize(s.before)}.`
          : 'Compression terminée.';
    });
  });

  /* Annonces vocales seulement aux changements de phase, jamais à chaque compteur. */
  let wasRunning = untrack(() => running > 0);
  $effect(() => {
    const now = running > 0;
    if (now === wasRunning) return;
    wasRunning = now;
    untrack(() => {
      announce = now
        ? 'Nommage lancé.'
        : `Nommage terminé : ${plural(c.done, 'fichier nommé', 'fichiers nommés')}${c.error ? `, ${plural(c.error, 'erreur', 'erreurs')}` : ''}.`;
    });
  });
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="bar sur-noir">
  <div class="progress" aria-hidden="true">
    {#if mode === 'compress'}
      <!-- Aucune couche rouge : un échec de compression n'est pas une erreur de l'outil. -->
      <span class="seg ia" style:transform="scaleX({ratio(c.total - s.wait)})"></span>
      <span class="seg ok" style:transform="scaleX({ratio(c.total - pressing)})"></span>
    {:else}
      <span class="seg err" style:transform="scaleX({ratio(c.done + running + c.error)})"></span>
      <span class="seg ia" style:transform="scaleX({ratio(c.done + running)})"></span>
      <span class="seg ok" style:transform="scaleX({ratio(c.done)})"></span>
    {/if}
  </div>
  <div class="inner" bind:offsetHeight={innerHeight}>
    <p class="summary">
      {#if mode === 'compress'}
        <span class="tete">
          {#if gainReady}
            <span class="visually-hidden">Images : </span><span class="compte">{formatSize(s.after)}</span>
            <span class="visually-hidden">{' au lieu de '}</span><span class="barre">{formatSize(s.before)}</span>
            <span class="gain">{formatGain(s.before, s.after)}</span>
          {:else if s.images > 0}
            <!-- Svelte retire les espaces en bord de balise : ils passent par une expression. -->
            <span class="compte">{settledImages}<span class="total">{` / ${s.images}`}</span></span>traitées
          {:else}
            <span class="compte">{c.total}</span>{c.total > 1 ? 'fichiers' : 'fichier'}
          {/if}
        </span>
      {:else}
        <span class="tete">
          {#if c.done > 0 || running > 0}
            <span class="compte">{c.done}<span class="total">{` / ${c.total}`}</span></span>{c.done > 1 ? 'nommés' : 'nommé'}
          {:else}
            <span class="compte">{c.total}</span>{c.total > 1 ? 'fichiers' : 'fichier'}
          {/if}
        </span>
        {#if running}<span class="chip run">{running} en cours</span>{/if}
        {#if c.reading}<span class="chip">{c.reading} en lecture</span>{/if}
        {#if mode === 'both' && s.images > 0}
          {#if pressing > 0}
            <span class="chip">compression {settledImages} / {s.images}</span>
          {:else if gainReady}
            <span class="chip poids-total"
              ><span class="visually-hidden">Images : </span><span class="barre">{formatSize(s.before)}</span><span class="visually-hidden"
                >{' réduites à '}</span
              ><b>{formatSize(s.after)}</b><span>{formatGain(s.before, s.after)}</span></span
            >
          {/if}
        {/if}
        {#if c.error}<button class="chip err" onclick={onshowerrors}>{plural(c.error, 'erreur', 'erreurs')}</button>{/if}
      {/if}
      {#if mode !== 'rename' && s.fail}<button class="chip warn" onclick={onshowfailed}>{s.fail} non compressée{s.fail > 1 ? 's' : ''}</button>{/if}
    </p>
    <p class="visually-hidden" aria-live="polite">{announce}</p>

    <div class="actions">
      {#if blocked}
        <span class="indispo">Nommage indisponible</span>
        <button class="btn-texte secondaire" onclick={showWhy}>Voir pourquoi</button>
      {/if}
      {#if showCsv}<button class="btn-texte secondaire" title={mode === 'rename' ? 'Ancien nom, nouveau nom et texte alternatif' : 'Noms, poids avant et après'} onclick={csv}>CSV</button>{/if}
      {#if showRetry}<button class="btn btn-contour-blanc secondaire" onclick={nameAll}>Relancer {plural(c.error, 'erreur', 'erreurs')}</button>{/if}
      {#if showZip && !zipPrimary}
        <button class="btn btn-contour-blanc secondaire" aria-busy={zipping} onclick={zip}>
          <span class="pile"><span class:off={zipping}>Télécharger le ZIP ({zipCount})</span><span class:off={!zipping}>Préparation du ZIP…</span></span>
        </button>
      {/if}
      {#if zipPrimary}
        <span class="archive">{zipName}</span>
        <button class="btn btn-rouge" bind:this={primary} aria-busy={zipping} aria-keyshortcuts={shortcut} onclick={zip}>
          <span class="pile"
            ><span class:off={zipping}><span class="d">{'Télécharger le '}</span>ZIP ({zipCount})</span><span class:off={!zipping}
              ><span class="d">{'Préparation du '}</span>ZIP…</span
            ></span
          >
          <kbd aria-hidden="true">{isMac ? '⌘' : 'Ctrl'}</kbd><kbd aria-hidden="true">↵</kbd>
        </button>
      {:else if showName}
        <button class="btn btn-rouge" bind:this={primary} aria-keyshortcuts={shortcut} onclick={nameAll} title={nameTitle}>
          <span>Nommer {toName}<span class="d">{toName > 1 ? ' fichiers' : ' fichier'}</span></span>
          <kbd aria-hidden="true">{isMac ? '⌘' : 'Ctrl'}</kbd><kbd aria-hidden="true">↵</kbd>
        </button>
      {/if}
      <button class="plus" popovertarget="bar-sheet" aria-label="Autres actions"><Icon name="more" /></button>
    </div>
  </div>
</div>

<div class="sheet" id="bar-sheet" popover="auto" bind:this={sheet} role="dialog" aria-label="Autres actions" ontoggle={onSheetToggle}>
  {#if confirmClear}
    <p class="sheet-titre" id="bar-sheet-question">Retirer {allFiles} de la liste ?</p>
    <button aria-describedby="bar-sheet-question" onclick={clearFromSheet}>Retirer {allFiles}</button>
    <button data-cancel aria-describedby="bar-sheet-question" onclick={() => setConfirm(false)}>Annuler</button>
  {:else}
    <!-- Les deux, sur mobile : la puce de poids est masquée dans la barre, le gain total se lit ici. -->
    {#if mode === 'both' && gainReady}
      <p class="sheet-titre">Images : {formatSize(s.after)} au lieu de {formatSize(s.before)} ({formatGain(s.before, s.after)})</p>
    {/if}
    {#if showZip && !zipPrimary}
      <button
        onclick={() => {
          sheet.hidePopover();
          zip();
        }}><Icon name="download" />Télécharger le ZIP ({zipCount})</button
      >
    {/if}
    {#if showCsv}
      <button
        onclick={() => {
          sheet.hidePopover();
          csv();
        }}>Télécharger le CSV</button
      >
    {/if}
    {#if showRetry}
      <button
        onclick={() => {
          sheet.hidePopover();
          nameAll();
        }}><Icon name="refresh" />Relancer {plural(c.error, 'erreur', 'erreurs')}</button
      >
    {/if}
    <button data-clear onclick={() => setConfirm(true)}><Icon name="close" />Tout retirer…</button>
  {/if}
</div>

<style>
  .bar {
    position: fixed;
    inset: auto 0 0;
    z-index: 20;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--noir);
    color: var(--blanc);
  }

  .progress {
    position: relative;
    height: 4px;
    overflow: hidden;
    background: var(--blanc-15);
  }

  .seg {
    position: absolute;
    inset: 0;
    transform-origin: left;
  }

  .seg.err {
    background: var(--rouge);
  }

  .seg.ia {
    background: var(--ia);
  }

  .seg.ok {
    background: var(--vert);
  }

  .inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s24);
    max-width: var(--contenu);
    min-height: 64px;
    margin: 0 auto;
    padding: var(--s8) var(--gutter);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s4) var(--s16);
    margin: 0;
    font-size: var(--t-14);
    color: var(--blanc-72);
  }

  .tete {
    display: inline-flex;
    align-items: baseline;
    gap: var(--s8);
  }

  .compte {
    font: 700 var(--t-20) / 1.2 var(--font-display);
    color: var(--blanc);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .compte .total {
    color: var(--blanc-72);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s8);
    font-variant-numeric: tabular-nums;
  }

  .chip.run::before,
  .chip.err::before,
  .chip.warn::before {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    background: var(--c);
  }

  .chip.run {
    --c: var(--ia);
  }

  .chip.err {
    --c: var(--rouge);
  }

  /* Ocre en forme seulement ; le texte de la puce reste blanc. */
  .chip.warn {
    --c: var(--ocre);
  }

  .tete .barre,
  .poids-total .barre {
    font-size: var(--t-14);
    color: var(--blanc-72);
    font-variant-numeric: tabular-nums;
  }

  .tete .gain,
  .poids-total b {
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--blanc);
    font-variant-numeric: tabular-nums;
  }

  button.chip {
    min-height: 36px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--blanc);
    font-weight: 600;
    text-decoration: underline 1px;
    text-underline-offset: 4px;
    cursor: pointer;
  }

  button.chip:hover {
    text-decoration-thickness: 2px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--s16);
  }

  .actions .btn-texte {
    color: var(--blanc);
  }

  .indispo {
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--blanc);
  }

  .btn-contour-blanc {
    background: transparent;
    border-color: var(--blanc-40);
    color: var(--blanc);
  }

  .btn-contour-blanc:hover {
    background: var(--blanc);
    border-color: var(--blanc);
    color: var(--noir);
  }

  .btn kbd {
    margin-left: var(--s4);
    border-color: var(--blanc-40);
    color: var(--blanc);
  }

  .archive {
    font: 400 var(--t-12) / 1 var(--font-mono);
    color: var(--blanc-72);
  }

  .plus {
    display: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .seg {
      transition: transform var(--lent) var(--courbe);
    }
  }

  @media (max-width: 1099px) {
    .archive,
    .btn kbd {
      display: none;
    }
  }

  @media (max-width: 719px) {
    .inner {
      gap: var(--s12);
    }

    .summary {
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
    }

    .summary .chip:not(.err):not(.warn) {
      display: none;
    }

    button.chip {
      min-height: 44px;
      margin: -12px 0;
      font-size: var(--t-12);
    }

    .actions {
      flex: 1;
      justify-content: flex-end;
      gap: var(--s8);
    }

    .secondaire {
      display: none;
    }

    .btn-rouge {
      flex: 1;
      padding: 0 var(--s16);
    }

    .plus {
      display: grid;
      place-items: center;
      flex: none;
      width: 44px;
      height: 44px;
      padding: 0;
      border: 1px solid var(--blanc-40);
      background: none;
      color: var(--blanc);
      cursor: pointer;
    }
  }

  @media (max-width: 479px) {
    .d {
      display: none;
    }
  }
</style>
