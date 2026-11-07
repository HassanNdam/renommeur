<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { app, editAlt, editSlug, nameParts, outgoing, removeEntry, renameOne, type Entry, type Press } from '../lib/store.svelte';
  import { downloadOne } from '../lib/download';
  import { formatGain, formatSize } from '../lib/format';
  import { KIND_LABEL } from '../lib/kinds';
  import { assignFileNames, slugify } from '../lib/slug';
  import { focusRow, rowAround, ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let { entry, n, finalName, dupOf }: { entry: Entry; n: number; finalName?: string; dupOf?: { n: number; id: string } } = $props();

  const STATUS: Record<Entry['status'], string> = {
    reading: 'Lecture',
    ready: 'Prêt',
    queued: 'En file',
    naming: 'Nommage',
    done: 'Nommé',
    error: 'Erreur',
  };
  const PRESS: Record<Press, string> = {
    wait: 'En attente',
    run: 'Compression',
    done: 'Compressée',
    same: 'Déjà optimisée',
    fail: 'Non compressée',
    skip: 'Tel quel',
  };
  const LONG_NAME = 60;
  const ALT_MAX = 125;

  let li: HTMLLIElement;
  /** Compresser seulement : la ligne ne parle que de compression. */
  const pressOnly = $derived(app.mode === 'compress');
  /** Les deux : le poids compressé remplace la taille, sans statut de plus. */
  const pressShown = $derived(app.mode !== 'rename');
  const press = $derived(entry.press);
  const out = $derived(entry.output);
  const pressSettled = $derived(press !== 'wait' && press !== 'run');
  const resized = $derived(!!out && (out.width !== out.srcWidth || out.height !== out.srcHeight));
  const done = $derived(entry.status === 'done');
  const retrying = $derived(entry.status === 'ready' && entry.attempts > 0);
  const rowState = $derived(pressOnly ? `c-${press}` : done ? (entry.edited ? 'edited' : 'done') : retrying ? 'retry' : entry.status);
  const label = $derived(
    pressOnly ? PRESS[press] : rowState === 'edited' ? 'Modifié' : rowState === 'retry' ? 'Nouvel essai' : STATUS[entry.status],
  );
  const parts = $derived(nameParts(entry));
  const extPart = $derived(parts?.ext ? `.${parts.ext}` : entry.ext ? `.${entry.ext}` : '');
  // Suffixe de doublon (« -2 ») posé par assignFileNames entre le nom et l'extension.
  const dupPart = $derived(parts && finalName ? finalName.slice(parts.base.length, finalName.length - extPart.length) : '');
  const withAlt = $derived(!pressOnly && (entry.kind === 'image' || entry.kind === 'video'));
  const canDownload = $derived(pressOnly ? pressSettled : done && (!pressShown || pressSettled));
  const noPreview = $derived(!entry.previewUrl && !entry.text);
  /** Ni lue ni compressée (HEIC sous Chrome…) : un seul signalement au lieu de deux. */
  const unread = $derived(pressShown && press === 'fail' && done && noPreview && withAlt);
  const canRenameIcon = $derived(done || (entry.status === 'ready' && !retrying));
  const nameLength = $derived(entry.slug.length + dupPart.length);
  const editing = $derived(done && ui.editingId === entry.id);
  const renameLabel = $derived(done ? (entry.edited ? 'Remplacer votre nom par une nouvelle proposition' : 'Proposer un autre nom') : 'Nommer ce fichier');

  let draft = $state<string | null>(null);
  const draftSlug = $derived(draft === null ? '' : slugify(draft, app.lang));
  /**
   * Nom réellement enregistré si l'on valide la saisie, doublons des autres lignes compris.
   * Même calcul que le store : les fichiers convertis (PNG passé en JPG…) sont numérotés en dernier.
   */
  const predicted = $derived.by(() => {
    if (!editing || draft === null) return null;
    const base = draftSlug || entry.slug;
    const list = app.entries.flatMap((e) => {
      const p = nameParts(e, e.id === entry.id ? base : e.slug);
      return p ? [{ id: e.id, slug: p.base, ext: p.ext, converted: app.mode !== 'rename' && !!e.output?.ext }] : [];
    });
    return assignFileNames(list).get(entry.id) ?? null;
  });
  const liveDup = $derived(predicted ? predicted.slice((draftSlug || entry.slug).length, predicted.length - extPart.length) : dupPart);
  const showWill = $derived(editing && draft !== null && (draftSlug !== draft || draftSlug === '' || liveDup !== ''));
  let altDraft = $state<string | null>(null);
  let altFocused = $state(false);
  const altLength = $derived((altDraft ?? entry.alt).length);
  let cancelled = false;

  /* Arrivée d'un nom : seulement au passage vers « nommé », jamais au montage (changement de filtre). */
  let arrived = $state(false);
  let previous = untrack(() => entry.status);
  $effect(() => {
    const status = entry.status;
    const before = previous;
    previous = status;
    if (pressOnly) return; // en « Compresser », l'arrivée est celle du résultat
    if (status !== 'done' || before === 'done') {
      arrived = false;
      return;
    }
    arrived = true;
    const timer = setTimeout(() => (arrived = false), 1200);
    return () => clearTimeout(timer);
  });

  /* Arrivée d'un résultat en « Compresser » : passage vers done ou same, jamais au montage. */
  let previousPress = untrack(() => entry.press);
  $effect(() => {
    const p = entry.press;
    const before = previousPress;
    previousPress = p;
    if (!pressOnly || before === p || (p !== 'done' && p !== 'same')) return;
    arrived = true;
    const timer = setTimeout(() => (arrived = false), 1200);
    return () => clearTimeout(timer);
  });

  /** Repli de field-sizing: content : la hauteur suit le contenu. */
  function autoHeight(node: HTMLTextAreaElement) {
    if (CSS.supports('field-sizing', 'content')) return;
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    node.addEventListener('input', fit);
    return { destroy: () => node.removeEventListener('input', fit) };
  }

  function openEditor(node: HTMLTextAreaElement) {
    cancelled = false;
    draft = node.value;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length); // curseur en fin de nom
    return autoHeight(node);
  }

  /** Ligne nommée voisine dans la liste affichée (ordre du DOM, donc du filtre). */
  function neighbour(step: 1 | -1): string | null {
    const rows = [...(li.parentElement?.querySelectorAll<HTMLElement>(':scope > li[data-done]') ?? [])];
    const i = rows.indexOf(li);
    return i === -1 ? null : (rows[i + step]?.dataset.id ?? null);
  }

  /** Rend le focus au nom de la ligne ; si elle a quitté la vue filtrée, à sa voisine. */
  async function focusOwnName(fallback: HTMLElement | null = null) {
    await tick();
    const own = li?.isConnected ? li.querySelector<HTMLElement>('.name-btn') : null;
    (own ?? fallback?.querySelector<HTMLElement>('.name-btn') ?? document.querySelector<HTMLElement>('.rows .none button'))?.focus();
  }

  /** Action qui retire ou masque le bouton cliqué : le focus reste dans la liste. */
  async function act(run: () => void) {
    const near = rowAround(entry.id);
    run();
    await tick();
    focusRow(li?.isConnected ? li : near, '.remove');
  }

  function onNameKey(event: KeyboardEvent) {
    const node = event.currentTarget as HTMLTextAreaElement;
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const fallback = (li.previousElementSibling ?? li.nextElementSibling) as HTMLElement | null;
      const next = neighbour(1);
      editSlug(entry.id, node.value);
      cancelled = true; // le blur qui suit ne refait rien
      draft = null;
      if (next) ui.editingId = next; // ouvre le nom suivant en édition
      else {
        ui.editingId = null;
        focusOwnName(fallback);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelled = true;
      draft = null;
      ui.editingId = null;
      focusOwnName();
    }
  }

  function onNameBlur(event: FocusEvent) {
    if (cancelled) {
      cancelled = false;
      return;
    }
    // Fenêtre quittée (copier un mot ailleurs) : l'édition reste ouverte, le navigateur y revient.
    if (!document.hasFocus()) return;
    editSlug(entry.id, (event.currentTarget as HTMLTextAreaElement).value);
    draft = null;
    if (ui.editingId === entry.id) ui.editingId = null;
  }

  /** ↑ / ↓ sur un nom au repos : passe au nom de la ligne nommée voisine. */
  function onNameButtonKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const id = neighbour(event.key === 'ArrowDown' ? 1 : -1);
    if (!id) return;
    event.preventDefault();
    li.parentElement?.querySelector<HTMLElement>(`li[data-id="${id}"] .name-btn`)?.focus();
  }

  function commitAlt(node: HTMLTextAreaElement) {
    editAlt(entry.id, node.value.replace(/\s*[\r\n]+\s*/g, ' '));
    altDraft = null;
  }

  function onAltKey(event: KeyboardEvent) {
    const node = event.currentTarget as HTMLTextAreaElement;
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      commitAlt(node);
      const next = neighbour(1);
      if (next) ui.editingId = next;
      else li.querySelector<HTMLElement>('.name-btn')?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      node.value = entry.alt;
      node.dispatchEvent(new Event('input')); // recalcule la hauteur sans field-sizing
      altDraft = null;
    }
  }

  async function goToOwner() {
    if (!dupOf) return;
    const find = () => document.querySelector<HTMLElement>(`.rows li[data-id="${dupOf.id}"] .name-btn`);
    let target = find();
    if (!target) {
      ui.filter = 'all';
      await tick();
      target = find();
    }
    target?.focus();
  }
</script>

<li
  bind:this={li}
  class="row"
  class:with-alt={withAlt}
  class:press={pressOnly}
  class:arrived
  data-id={entry.id}
  data-state={rowState}
  data-kind={entry.kind}
  data-done={done || undefined}
>
  <span class="num"><span class="visually-hidden">{'N° '}</span>{n}</span>

  <div class="thumb">
    {#if entry.previewUrl}
      <img src={entry.previewUrl} alt="" decoding="async" in:fade={{ duration: 200 }} />
    {:else}
      <span>{(entry.ext || KIND_LABEL[entry.kind]).toLowerCase()}</span>
    {/if}
  </div>

  <div class="body">
    {#if pressOnly}
      <!-- Compresser : le nom d'origine, extension de sortie, sans édition ni ancien nom. -->
      <p class="name">
        <span>{parts?.base}</span>{#if dupPart}<span class="dup">{dupPart}</span>{/if}<span class="ext">{extPart}</span>
      </p>
    {:else if editing}
      <div class="name editing">
        <textarea
          class="slug"
          rows="1"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-label="Nouveau nom de {entry.file.name}"
          aria-describedby="will-{entry.id}"
          value={entry.slug}
          use:openEditor
          oninput={(e) => (draft = e.currentTarget.value)}
          onkeydown={onNameKey}
          onblur={onNameBlur}
        ></textarea><span class="ext" aria-hidden="true">{liveDup}{extPart}</span>
      </div>
    {:else if done}
      <button class="name name-btn" aria-label="Modifier le nom : {finalName}" onclick={() => (ui.editingId = entry.id)} onkeydown={onNameButtonKey}
        ><span class="slug-text">{entry.slug}</span>{#if dupPart}<span class="dup">{dupPart}</span>{/if}<span class="ext">{extPart}</span></button
      >
    {:else}
      <p class="name orig">{entry.file.name}</p>
    {/if}

    <p class="meta">
      <span class="status">{label}</span>
      {#if pressOnly}
        {#if dupOf}<button class="flag" onclick={goToOwner}>Même nom que le n° {dupOf.n}</button>{/if}
      {:else}
        {#if showWill}
          <span class="will" id="will-{entry.id}"
            >{#if draftSlug}Sera enregistré : <code>{predicted}</code>{:else}Nom vide : la proposition est conservée.{/if}</span
          >
        {:else if done}
          <span class="was" title={entry.file.name}>{entry.file.name}</span>
        {/if}
        {#if entry.status === 'error'}
          <span class="why">{entry.error}</span>
          {#if !app.apiProblem}<button class="btn-texte inline retry" onclick={() => act(() => renameOne(entry.id))}>Réessayer</button>{/if}
        {/if}
        <!-- Pendant la saisie, l'aperçu prend la place de ces mentions : la ligne ne grandit pas. -->
        {#if !showWill}
          {#if pressShown && press === 'done' && out}
            <!-- Les dimensions, masquées sur mobile, restent dans l'infobulle. -->
            <span
              class="poids"
              title={resized ? `Redimensionnée à ${out.width} × ${out.height} (${out.srcWidth} × ${out.srcHeight} à l’origine)` : undefined}
              in:fade={{ duration: 200 }}
            >
              <span class="visually-hidden">Poids </span><span class="barre">{formatSize(entry.file.size)}</span>
              <span class="visually-hidden">, réduit à </span><b>{formatSize(out.blob.size)}</b>
              <span class="gain">{formatGain(entry.file.size, out.blob.size)}</span>
              {#if resized}<span class="dims" title="Redimensionnée : {out.srcWidth} × {out.srcHeight} à l’origine"
                  ><span class="visually-hidden">redimensionnée à </span>{out.width} × {out.height}</span
                >{/if}
            </span>
            {#if out.ext}<span class="note" title={entry.pressNote}>{entry.pressNote}</span>{/if}
          {:else if pressShown && press === 'same'}
            <span class="size">{formatSize(out?.blob.size ?? entry.file.size)}, {entry.pressNote === 'Déjà légère' ? 'déjà légère' : 'déjà optimisée'}</span>
          {:else}
            <span class="size">{formatSize(entry.file.size)}</span>
          {/if}
          {#if dupOf}<button class="flag" onclick={goToOwner}>Même nom que le n° {dupOf.n}</button>{/if}
          {#if done && nameLength > LONG_NAME}<span class="flag">Nom long : {nameLength} caractères</span>{/if}
          {#if unread}
            <span class="flag">Format non lu : nom et alt à vérifier, poids inchangé</span>
          {:else}
            {#if done && noPreview}
              {#if withAlt}<span class="flag">Sans aperçu : nom et alt à vérifier</span>{:else}<span class="note">d’après le nom d’origine</span>{/if}
            {/if}
            {#if pressShown && press === 'fail'}<span class="flag">Non compressée : {entry.pressNote}</span>{/if}
          {/if}
        {/if}
      {/if}
    </p>
  </div>

  {#if pressOnly}
    <div class="result">
      {#if press === 'done' && out}
        <p class="r1"><b>{formatSize(out.blob.size)}</b><span class="gain">{formatGain(entry.file.size, out.blob.size)}</span></p>
        <p class="r2">
          <span class="visually-hidden">au lieu de </span><span class="barre">{formatSize(entry.file.size)}</span>
          {#if resized}<span class="visually-hidden">, redimensionnée de </span><span class="barre">{out.srcWidth} × {out.srcHeight}</span><span
              class="visually-hidden">{' à '}</span
            ><span class="dims">{out.width} × {out.height}</span>{/if}
          {#if out.ext}<span>{entry.pressNote}</span>{/if}
        </p>
      {:else if press === 'same'}
        <p class="r1"><b>{formatSize(out?.blob.size ?? entry.file.size)}</b></p>
        <!-- Image gardée : nouveau blob si des métadonnées ont été retirées, sinon l'original part tel quel. -->
        <p class="r2">
          {out && out.blob !== entry.file
            ? 'métadonnées retirées'
            : entry.pressNote === 'Déjà légère'
              ? 'déjà légère, gardée telle quelle'
              : 'gardée telle quelle'}
        </p>
      {:else}
        <p class="r1 avant">{formatSize(entry.file.size)}</p>
        {#if (press === 'fail' || press === 'skip') && entry.pressNote}<p class="r2">{entry.pressNote}</p>{/if}
      {/if}
    </div>
  {:else if withAlt}
    <div class="alt">
      {#if done}
        <label class="alt-label" for="alt-{entry.id}">Alt<span class="visually-hidden">{` de ${finalName ?? entry.file.name}`}</span></label>
        <textarea
          id="alt-{entry.id}"
          class="alt-input"
          rows="1"
          value={entry.alt}
          placeholder="Texte alternatif"
          use:autoHeight
          onfocus={() => (altFocused = true)}
          onblur={() => (altFocused = false)}
          oninput={(e) => (altDraft = e.currentTarget.value)}
          onchange={(e) => commitAlt(e.currentTarget)}
          onkeydown={onAltKey}
        ></textarea>
        {#if altFocused || altLength > ALT_MAX}
          <span class="alt-count" class:long={altLength > ALT_MAX}
            >{altLength > ALT_MAX ? `${altLength} caractères, ${ALT_MAX} conseillés` : `${altLength} / ${ALT_MAX}`}</span
          >
        {/if}
      {/if}
    </div>
  {/if}

  <div class="actions">
    <button
      class:off={!canDownload}
      title={pressOnly ? 'Télécharger ce fichier' : 'Télécharger sous ce nom'}
      aria-label="Télécharger {finalName}"
      onclick={() => downloadOne(outgoing(entry), finalName!)}
    >
      <Icon name="download" />
    </button>
    <button
      class:off={pressOnly || !canRenameIcon}
      title={renameLabel}
      aria-label="{renameLabel} : {entry.file.name}"
      onclick={() => act(() => renameOne(entry.id))}
    >
      <Icon name="refresh" />
    </button>
    <button class="remove" title="Retirer de la liste" aria-label="Retirer {entry.file.name}" onclick={() => act(() => removeEntry(entry.id))}>
      <Icon name="close" />
    </button>
  </div>

  <button class="more" popovertarget="row-sheet" aria-label="Actions pour {finalName ?? entry.file.name}" onclick={() => (ui.sheetFor = entry.id)}>
    <Icon name="more" />
  </button>
</li>

<style>
  .row {
    --etat-texte: var(--gris);
    --etat-bord: var(--gris);
    --etat-plein: transparent;
    display: grid;
    grid-template-columns: 32px 48px minmax(0, 5fr) minmax(0, 4fr) 124px;
    grid-template-areas: 'num thumb body alt actions';
    column-gap: var(--s16);
    align-items: start;
    padding: var(--s12) var(--s16);
    border-bottom: 1px solid var(--filet);
    transition: background-color var(--vite) var(--courbe);
    content-visibility: auto;
    contain-intrinsic-size: auto 72px;
  }

  .row:not(.with-alt) .body {
    grid-column: 3 / 5;
  }

  /* Compresser : la cellule Poids prend la zone de l'alt. */
  .row.press:not(.with-alt) .body {
    grid-column: auto;
  }

  .row:hover {
    background: var(--survol);
  }

  .row:focus-within {
    background: var(--actif);
  }

  .row.arrived {
    animation: arrivee 900ms ease-out;
  }

  @keyframes arrivee {
    from {
      background-color: var(--vert-voile);
    }
  }

  .num {
    grid-area: num;
    font-size: var(--t-12);
    line-height: 1.25rem;
    text-align: right;
    color: var(--gris-doux);
    font-variant-numeric: tabular-nums;
  }

  /* Vignette */
  .thumb {
    grid-area: thumb;
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    overflow: hidden;
    background: var(--fond);
  }

  .thumb::after {
    content: '';
    position: absolute;
    inset: 0;
    box-shadow: inset 0 0 0 1px var(--voile-08);
    pointer-events: none;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .row:is([data-kind='pdf'], [data-kind='document'], [data-kind='presentation'], [data-kind='spreadsheet']) .thumb img {
    object-fit: contain;
    padding: 4px;
    background: var(--blanc);
  }

  .thumb span {
    font: 600 var(--t-12) / 1 var(--font-mono);
    text-transform: lowercase;
  }

  .row[data-kind='document'] .thumb {
    background: color-mix(in srgb, var(--f-document) 14%, var(--blanc));
  }

  .row[data-kind='spreadsheet'] .thumb {
    background: color-mix(in srgb, var(--f-tableur) 14%, var(--blanc));
  }

  .row[data-kind='presentation'] .thumb {
    background: color-mix(in srgb, var(--f-diapo) 14%, var(--blanc));
  }

  .row[data-kind='pdf'] .thumb {
    background: color-mix(in srgb, var(--f-pdf) 14%, var(--blanc));
  }

  .row:is([data-kind='video'], [data-kind='audio']) .thumb {
    background: color-mix(in srgb, var(--f-media) 14%, var(--blanc));
  }

  /* Nom */
  .body {
    grid-area: body;
    min-width: 0;
  }

  .name {
    display: block;
    margin: 0;
    font: 600 var(--t-15) / 1.25rem var(--font-mono);
    overflow-wrap: anywhere;
  }

  .name.orig {
    font-weight: 400;
    color: var(--gris);
  }

  .name-btn {
    width: fit-content;
    max-width: calc(100% + 8px);
    margin: -2px -4px;
    padding: 2px 4px;
    border: 0;
    background: none;
    color: var(--noir);
    text-align: left;
    cursor: text;
    transition: background-color var(--vite) var(--courbe);
  }

  .name-btn:hover {
    background: var(--voile-04);
  }

  .name-btn:focus-visible {
    outline-offset: 0;
  }

  .slug-text {
    text-decoration: underline dotted 1px var(--trait);
    text-underline-offset: 5px;
  }

  .ext {
    font-weight: 400;
    color: var(--gris);
  }

  .dup {
    text-decoration: underline dotted 1px var(--noir);
    text-underline-offset: 5px;
  }

  /* Édition : le texte reste au pixel près (bordure 2 + marge intérieure 4 = 6 à gauche, 2 + 2 = 4 en haut). */
  .name.editing {
    display: flex;
    align-items: last baseline;
  }

  .slug {
    flex: 0 1 auto;
    field-sizing: content;
    min-width: 8ch;
    max-width: 100%;
    margin: -4px 0 -4px -6px;
    padding: 2px 4px;
    border: 2px solid var(--noir);
    background: var(--blanc);
    color: var(--noir);
    font: inherit;
    line-height: 1.25rem;
    overflow: hidden;
    overflow-wrap: anywhere;
    resize: none;
    outline: none;
  }

  .name.editing .ext {
    flex: none;
  }

  @supports not (field-sizing: content) {
    .slug {
      flex: 1 1 auto;
    }
  }

  /* Ligne 2 */
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s4) var(--s12);
    margin: var(--s4) 0 0;
    font-size: var(--t-12);
    line-height: 1rem;
    color: var(--gris);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 80px;
    font-weight: 600;
    color: var(--etat-texte);
  }

  .status::before {
    content: '';
    flex: none;
    width: 8px;
    height: 8px;
    background: var(--etat-plein);
    box-shadow: inset 0 0 0 2px var(--etat-bord);
  }

  .row[data-state='reading'] {
    --etat-texte: var(--gris-doux);
    --etat-bord: var(--trait);
  }

  .row:is([data-state='queued'], [data-state='retry'], [data-state='naming']) {
    --etat-texte: var(--ia-texte);
    --etat-bord: var(--ia);
  }

  .row[data-state='done'] {
    --etat-texte: var(--vert);
    --etat-bord: var(--vert);
    --etat-plein: var(--vert);
  }

  .row[data-state='edited'] {
    --etat-texte: var(--noir);
    --etat-bord: var(--noir);
    --etat-plein: var(--noir);
  }

  .row[data-state='error'] {
    --etat-texte: var(--rouge);
    --etat-bord: var(--rouge);
    --etat-plein: var(--rouge);
  }

  .row[data-state='naming'] .status::before {
    background: linear-gradient(var(--ia), var(--ia)) bottom / 100% 50% no-repeat;
  }

  .was {
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 400 var(--t-13) / 1rem var(--font-mono);
  }

  /* Geste signature : le trait de correction, gris, jamais rouge. */
  .row[data-done] .was::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: calc(50% + 1px);
    height: 1px;
    background: currentColor;
    opacity: 0.7;
    transform-origin: left;
  }

  .will code {
    font: 600 var(--t-13) / 1rem var(--font-mono);
    color: var(--noir);
    overflow-wrap: anywhere;
  }

  .why {
    color: var(--rouge);
    font-weight: 500;
    overflow-wrap: anywhere;
  }

  .retry {
    font-size: var(--t-12);
    font-weight: 600;
    color: var(--noir);
  }

  .size {
    font-variant-numeric: tabular-nums;
  }

  .note {
    color: var(--gris-doux);
  }

  .flag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--noir);
    font-weight: 600;
  }

  .flag::before {
    content: '';
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--ocre);
  }

  button.flag {
    padding: 10px 4px;
    margin: -10px -4px;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 600;
    text-decoration: underline 1px;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  @media (pointer: coarse) {
    button.flag {
      padding-block: 14px;
      margin-block: -14px;
    }
  }

  /* Poids : ancien barré au trait de correcteur (.barre, global), nouveau en noir, gain en gris. */
  .poids {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s8);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .poids b,
  .result b {
    font-weight: 600;
    color: var(--noir);
  }

  .poids .gain,
  .result .gain {
    font-weight: 500;
    color: var(--gris);
  }

  .poids .dims,
  .result .dims {
    color: var(--gris-doux);
    white-space: nowrap;
  }

  .result {
    grid-area: alt;
    min-width: 0;
    min-height: 40px;
    font-variant-numeric: tabular-nums;
  }

  .result p {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--s8);
    margin: 0;
  }

  .r1 {
    font-size: var(--t-14);
    line-height: 20px;
  }

  .r1.avant {
    color: var(--gris);
  }

  .result .r2 {
    margin-top: var(--s4);
    font-size: var(--t-12);
    line-height: 16px;
    color: var(--gris);
  }

  /* États de compression (Compresser seulement) : carré et libellé, comme le nommage. */
  .row[data-state='c-wait'] {
    --etat-texte: var(--gris-doux);
    --etat-bord: var(--trait);
  }

  .row[data-state='c-run'] {
    --etat-texte: var(--ia-texte);
    --etat-bord: var(--ia);
  }

  .row[data-state='c-run'] .status::before {
    background: linear-gradient(var(--ia), var(--ia)) bottom / 100% 50% no-repeat;
  }

  .row:is([data-state='c-done'], [data-state='c-same']) {
    --etat-texte: var(--vert);
    --etat-bord: var(--vert);
    --etat-plein: var(--vert);
  }

  .row[data-state='c-fail'] {
    --etat-texte: var(--noir);
    --etat-bord: var(--ocre);
    --etat-plein: var(--ocre);
  }

  .row[data-state='c-skip'] {
    --etat-texte: var(--gris);
  }

  .row.press.arrived .r1 {
    animation: apparait var(--moyen) var(--courbe);
  }

  /* Texte alternatif : jamais coupé ; deux lignes réservées par .alt, pas par le champ. */
  .alt {
    grid-area: alt;
    min-width: 0;
    min-height: 40px;
  }

  .alt-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .alt-input {
    display: block;
    width: calc(100% + 16px);
    field-sizing: content;
    min-height: calc(1.25rem + 9px);
    margin: -4px -8px;
    padding: 4px 8px;
    border: 0;
    border-bottom: 1px dotted var(--trait);
    background: transparent;
    color: var(--noir);
    font-size: var(--t-14);
    line-height: 1.25rem;
    overflow: hidden;
    resize: none;
    transition: background-color var(--vite) var(--courbe);
  }

  .alt-input:hover {
    background: var(--voile-04);
  }

  /* Contour transparent : invisible ici, mais redessiné en mode couleurs forcées. */
  .alt-input:focus {
    outline: 2px solid transparent;
    outline-offset: -2px;
    background: var(--blanc);
    border-bottom-color: transparent;
    box-shadow: 0 0 0 2px var(--noir);
  }

  .alt-count {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    margin-top: var(--s8);
    font-size: var(--t-12);
    color: var(--gris-doux);
    font-variant-numeric: tabular-nums;
  }

  .alt-count.long {
    color: var(--noir);
    font-weight: 600;
  }

  .alt-count.long::before {
    content: '';
    width: 6px;
    height: 6px;
    background: var(--ocre);
  }

  /* Actions */
  .actions {
    grid-area: actions;
    display: flex;
    justify-content: flex-end;
    gap: var(--s4);
    margin-top: 6px;
  }

  .actions button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--trait);
    cursor: pointer;
    transition:
      color var(--vite) var(--courbe),
      background-color var(--vite) var(--courbe);
  }

  .row:is(:hover, :focus-within) .actions button {
    color: var(--noir);
  }

  .actions button:hover {
    background: var(--noir);
    color: var(--blanc);
  }

  .actions .off {
    visibility: hidden;
  }

  .actions .remove {
    margin-left: var(--s8);
  }

  @media (hover: none) {
    .actions button {
      color: var(--noir);
    }
  }

  .more {
    display: none;
  }

  @media (prefers-reduced-motion: no-preference) {
    .row:is([data-state='naming'], [data-state='c-run']) .status::before {
      animation: remplir 1.2s var(--courbe) infinite;
    }

    .row.press.arrived .result .barre::after {
      animation: trace var(--lent) var(--courbe) 120ms both;
    }

    @keyframes remplir {
      from {
        background-size: 100% 0%;
      }
      to {
        background-size: 100% 100%;
      }
    }

    .arrived .name-btn {
      animation: apparait var(--moyen) var(--courbe);
    }

    .arrived .was::after {
      animation: trace var(--lent) var(--courbe) 120ms both;
    }

    @keyframes trace {
      from {
        transform: scaleX(0);
      }
    }
  }

  /* Mouvement réduit : le fondu reste, le trait est posé directement. */
  @media (prefers-reduced-motion: reduce) {
    .arrived .name-btn {
      animation: apparait var(--moyen) linear;
    }
  }

  @keyframes apparait {
    from {
      opacity: 0;
    }
  }

  /*
   * Ligne nommée en « Renommer » et « Les deux » : l'arrivée du poids ne la fait pas grandir.
   * Un flex-wrap renvoie un élément à la ligne avant de le rétrécir : ici l'ancien nom et la note
   * se raccourcissent (ellipse, texte entier en infobulle). Les lignes à signalement gardent le retour à la ligne.
   */
  @media (min-width: 720px) {
    .row[data-done]:not(.press) .meta:not(:has(.flag)) {
      flex-wrap: nowrap;
    }

    .row[data-done]:not(.press) .meta > :is(.status, .size, .poids) {
      flex: none;
    }

    .row[data-done]:not(.press) .note {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row:not(.press) .poids {
      flex-wrap: nowrap;
    }
  }

  @media (max-width: 1023px) {
    .row {
      grid-template-columns: 32px 48px minmax(0, 1fr) 124px;
      grid-template-areas:
        'num thumb body actions'
        'num thumb alt actions';
    }

    .row.with-alt {
      contain-intrinsic-size: auto 120px;
    }

    .row:not(.with-alt) .body {
      grid-column: auto;
    }

    .alt {
      display: flex;
      align-items: flex-start;
      gap: var(--s12);
      margin-top: var(--s8);
    }

    .alt-label {
      position: static;
      width: auto;
      height: auto;
      overflow: visible;
      clip: auto;
      flex: none;
      font-size: var(--t-12);
      font-weight: 600;
      line-height: 1.25rem;
      color: var(--gris);
    }

    .alt-input {
      flex: 1;
      width: auto;
      min-width: 0;
    }

    .result {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      column-gap: var(--s12);
      min-height: 0;
      margin-top: var(--s8);
    }

    /* L'ancien poids toujours sur sa propre ligne : la colonne des poids garde son rythme. */
    .result .r2 {
      flex-basis: 100%;
      margin-top: 0;
    }
  }

  @media (max-width: 719px) {
    .row {
      grid-template-columns: 48px minmax(0, 1fr) 44px;
      grid-template-areas:
        'thumb body more'
        'thumb alt alt';
      column-gap: var(--s12);
      padding: var(--s12);
    }

    .num,
    .actions {
      display: none;
    }

    .more {
      grid-area: more;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin: -12px -12px 0 0;
      padding: 0;
      border: 0;
      background: none;
      color: var(--noir);
      cursor: pointer;
    }

    /* Le statut prend sa ligne : l'ancien nom suit, et son trait ne dépasse pas du texte. */
    .status {
      flex-basis: 100%;
    }

    /* Ligne nommée : statut, ancien nom, puis poids et note, chacun sur sa ligne avant comme après le résultat. */
    .row[data-done]:not(.press) .was {
      flex-basis: 100%;
    }

    .row:not(.press) .poids .dims {
      display: none;
    }

    .row[data-done]:not(.press) .note {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* 16 px évite le zoom d'iOS au focus. */
    .slug,
    .alt-input {
      font-size: var(--t-16);
    }
  }
</style>
