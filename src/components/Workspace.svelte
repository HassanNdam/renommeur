<script lang="ts">
  import { tick } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { expoOut } from 'svelte/easing';
  import {
    addFiles,
    app,
    clearAll,
    nameParts,
    outgoing,
    remember,
    removeEntry,
    renameOne,
    setMode,
    view,
    type Entry,
    type Mode,
  } from '../lib/store.svelte';
  import { api, ApiError } from '../lib/api';
  import { downloadOne } from '../lib/download';
  import { withExt } from '../lib/slug';
  import { AIDE_COMPRESSION, resumeSqueeze } from '../lib/format';
  import Seg from './Seg.svelte';
  import CompressionSettings from './CompressionSettings.svelte';
  import { filesFromDrop } from '../lib/dropped';
  import { ui, showToast, closeToast, pauseToast, resumeToast, reduceMotion, rowAround, focusRow, type Filter } from '../lib/ui.svelte';
  import Logo from './Logo.svelte';
  import FileRow from './FileRow.svelte';
  import ActionBar from './ActionBar.svelte';
  import Icon from './Icon.svelte';

  let dragDepth = $state(0);
  let picker: HTMLInputElement;
  let rowSheet: HTMLElement;
  let editingContext = $state(false);
  let editingCompression = $state(false);
  let confirmClear = $state(false);
  let checking = $state(false);

  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  const counts = $derived(view.counts);
  const s = $derived(view.squeeze);
  const resume = $derived(resumeSqueeze(app.squeeze));

  const MODES = [
    { v: 'rename', l: 'Renommer', name: 'Renommer seulement' },
    { v: 'compress', l: 'Compresser', name: 'Compresser seulement' },
    { v: 'both', l: 'Les deux', name: 'Les deux : renommer et compresser' },
  ] as const;
  const MODE_DIT: Record<Mode, string> = {
    rename: 'Claude propose un nom et un texte alternatif pour chaque fichier.',
    compress: 'Les images sont compressées sur votre poste dès le dépôt ; les noms restent ceux d’origine.',
    both: 'Claude propose les noms et les textes alternatifs ; les images sont compressées sur votre poste dès le dépôt.',
  };
  const DROP_NOTE: Record<Mode, string> = {
    rename: 'Images, PDF, Word, Excel, PowerPoint et vidéos ; dossiers acceptés.',
    compress: 'JPEG, PNG et WebP sont compressés ; les autres fichiers sont copiés tels quels. Dossiers acceptés.',
    both: 'Images, PDF, Word, Excel, PowerPoint et vidéos ; dossiers acceptés.',
  };
  const hasFiles = $derived(counts.total > 0);
  const numbers = $derived(new Map(app.entries.map((e, i) => [e.id, i + 1])));
  const retrying = $derived(app.entries.filter((e) => e.status === 'ready' && e.attempts > 0).length);

  /**
   * Doublons, tirés des noms attribués par assignFileNames : une ligne est un doublon quand
   * elle n'a pas pu garder son nom nu ; on renvoie à la ligne qui le porte.
   */
  const dupOf = $derived.by(() => {
    const names = view.fileNames;
    const owner = new Map<string, string>();
    for (const [id, name] of names) owner.set(name.toLowerCase(), id);
    const out = new Map<string, { n: number; id: string }>();
    for (const e of app.entries) {
      const parts = nameParts(e);
      if (!parts) continue;
      const bare = withExt(parts.base || 'fichier', parts.ext);
      const holder = owner.get(bare.toLowerCase());
      if (names.get(e.id) !== bare && holder && holder !== e.id) out.set(e.id, { n: numbers.get(holder)!, id: holder });
    }
    return out;
  });
  const editedCount = $derived(app.entries.filter((e) => e.status === 'done' && e.edited).length);

  /** Le titre de la liste dit où en est le lot. */
  const phaseTitle = $derived.by(() => {
    const c = counts;
    if (app.mode === 'compress') {
      if (s.images === 0) return 'Aucune image à compresser';
      if (s.wait + s.run > 0) return 'Compression en cours';
      const ok = s.done + s.same;
      return ok > 0 ? plural(ok, 'image optimisée', 'images optimisées') : plural(s.fail, 'image non compressée', 'images non compressées');
    }
    if (c.pending + retrying > 0) return 'Nommage en cours';
    const todo = c.reading + c.ready;
    if (todo > 0)
      return c.reading === c.total ? `Lecture de ${plural(todo, 'fichier', 'fichiers')}` : `${plural(todo, 'fichier', 'fichiers')} à nommer`;
    if (c.error > 0) return `${plural(c.error, 'erreur', 'erreurs')} à reprendre`;
    if (app.mode === 'both' && s.wait + s.run > 0) return 'Compression en cours';
    return plural(c.done, 'fichier nommé', 'fichiers nommés');
  });

  function match(e: Entry): boolean {
    switch (ui.filter) {
      case 'todo':
        return e.status !== 'done' && e.status !== 'error';
      case 'done':
        return e.status === 'done';
      case 'edited':
        return e.status === 'done' && e.edited;
      case 'error':
        return e.status === 'error';
      case 'dup':
        return dupOf.has(e.id);
      case 'squeezed':
        return e.press === 'done';
      case 'optimal':
        return e.press === 'same';
      case 'unsqueezed':
        return e.press === 'fail';
      default:
        return true;
    }
  }
  const visible = $derived(app.entries.filter(match));
  const filters = $derived(
    (app.mode === 'compress'
      ? [
          { key: 'all' as Filter, label: 'Tous', n: counts.total, show: true },
          { key: 'squeezed' as Filter, label: 'Compressées', n: s.done, show: true },
          { key: 'optimal' as Filter, label: 'Déjà optimisées', n: s.same, show: s.same > 0 },
          { key: 'unsqueezed' as Filter, label: 'Non compressées', n: s.fail, show: s.fail > 0 },
          { key: 'dup' as Filter, label: 'Doublons', n: dupOf.size, show: dupOf.size > 0 },
        ]
      : [
          { key: 'all' as Filter, label: 'Tous', n: counts.total, show: true },
          { key: 'todo' as Filter, label: 'À nommer', n: counts.total - counts.done - counts.error, show: true },
          { key: 'done' as Filter, label: 'Nommés', n: counts.done, show: true },
          { key: 'edited' as Filter, label: 'Modifiés', n: editedCount, show: editedCount > 0 },
          { key: 'error' as Filter, label: 'Erreurs', n: counts.error, show: counts.error > 0 },
          { key: 'dup' as Filter, label: 'Doublons', n: dupOf.size, show: dupOf.size > 0 },
          { key: 'unsqueezed' as Filter, label: 'Non compressées', n: s.fail, show: app.mode === 'both' && s.fail > 0 },
        ]
    ).filter((f) => f.show || ui.filter === f.key), // un filtre actif ne disparaît pas sous le curseur
  );
  // Un filtre qui n'existe pas dans le nouveau traitement ramène à « Tous ».
  const MODE_FILTERS: Record<Mode, Filter[]> = {
    rename: ['all', 'todo', 'done', 'edited', 'error', 'dup'],
    both: ['all', 'todo', 'done', 'edited', 'error', 'dup', 'unsqueezed'],
    compress: ['all', 'squeezed', 'optimal', 'unsqueezed', 'dup'],
  };
  $effect(() => {
    if (!MODE_FILTERS[app.mode].includes(ui.filter)) ui.filter = 'all';
  });
  const EMPTY: Record<Filter, string> = {
    all: 'Aucun fichier.',
    todo: 'Rien à nommer pour l’instant.',
    done: 'Aucun fichier nommé pour l’instant.',
    edited: 'Aucun nom modifié.',
    error: 'Aucun fichier en erreur.',
    dup: 'Aucun doublon.',
    squeezed: 'Aucune image compressée pour l’instant.',
    optimal: 'Aucune image déjà optimisée.',
    unsqueezed: 'Aucune image non compressée.',
  };

  const modelLabel = $derived(
    (app.settings?.model ?? '')
      .replace(/^claude-/, 'Claude ')
      .replace(/-(\d+)-(\d+)$/, ' $1.$2')
      .replace(/ (\w)/g, (_, c: string) => ' ' + c.toUpperCase()),
  );

  $effect(() => {
    if (!hasFiles) {
      ui.filter = 'all';
      ui.editingId = null;
      editingContext = false;
      editingCompression = false;
      confirmClear = false;
    }
  });

  /** Applique un filtre et le garde visible dans la bande des filtres (qui défile sur mobile). */
  async function pick(key: Filter) {
    ui.filter = key;
    await tick();
    document.querySelector('.filters [aria-pressed="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  /** Une liste chargée ne vit qu'en mémoire : le navigateur demande confirmation avant de la perdre. */
  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (counts.done + counts.pending + s.done > 0) event.preventDefault();
  }

  function report(added: number, received: number) {
    const skipped = received - added;
    if (skipped > 0)
      showToast({
        text:
          skipped > 1
            ? `${skipped} fichiers ignorés : déjà dans la liste, vides ou fichiers système.`
            : '1 fichier ignoré : déjà dans la liste, vide ou fichier système.',
      });
  }

  const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

  /** Au premier ajout, la zone de dépôt disparaît : le focus passe au titre de la liste. */
  async function afterAdd(files: File[]) {
    const wasEmpty = !hasFiles;
    if (wasEmpty) editingCompression = false; // le bandeau arrive replié
    const added = addFiles(files);
    report(added, files.length);
    if (wasEmpty && added) {
      await tick();
      document.getElementById('files-title')?.focus();
    }
  }

  async function onDrop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    await afterAdd(await filesFromDrop(event.dataTransfer!));
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    void afterAdd(files);
  }

  async function retryApi() {
    if (checking) return;
    checking = true;
    try {
      const result = await api.ping();
      app.apiProblem = result.ok ? null : (result.reason ?? 'L’API Claude ne répond pas.');
      if (result.ok) {
        // Le bandeau et son bouton disparaissent : on le dit, et le focus reste dans la page.
        showToast({ text: 'Le nommage est de nouveau disponible.' });
        await tick();
        (document.getElementById('files-title') ?? document.querySelector<HTMLElement>('.drop'))?.focus();
      }
    } catch (e) {
      app.apiProblem = e instanceof ApiError ? e.message : 'L’API Claude ne répond pas.';
    } finally {
      checking = false;
    }
  }

  async function showFailed() {
    await pick('unsqueezed');
    document.getElementById('files-title')?.focus();
  }

  async function showErrors() {
    await pick('error');
    document.querySelector<HTMLElement>('.rows li[data-state="error"] .retry')?.focus();
  }

  const LANGS = [
    { code: 'fr', name: 'Français' },
    { code: 'en', name: 'Anglais' },
  ] as const;

  function setLang(code: 'fr' | 'en') {
    app.lang = code;
    remember('lang', code);
  }

  const LANG_OPTIONS = LANGS.map((l) => ({ v: l.code, l: l.code.toUpperCase(), name: `${l.code.toUpperCase()}, ${l.name.toLowerCase()}` }));

  /* Contexte et réglages de compression : un seul panneau ouvert à la fois. */
  async function openCompression() {
    editingContext = false;
    editingCompression = true;
    await tick();
    document.querySelector<HTMLElement>('.cmp-panel [aria-checked="true"], .cmp-edit [aria-checked="true"]')?.focus();
  }

  function onCompressionKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void closeCompression();
  }

  async function closeCompression() {
    editingCompression = false;
    await tick();
    document.getElementById('cmp-edit-btn')?.focus();
  }

  async function openContext() {
    editingCompression = false;
    editingContext = true;
    await tick();
    document.getElementById('context')?.focus();
  }

  async function closeContext() {
    editingContext = false;
    await tick();
    document.getElementById('ctx-edit-btn')?.focus();
  }

  async function askClear() {
    confirmClear = true;
    await tick();
    document.getElementById('clear-cancel')?.focus();
  }

  async function cancelClear() {
    confirmClear = false;
    await tick();
    document.getElementById('clear-ask')?.focus();
  }

  function cancelClearOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') void cancelClear();
  }

  async function doClear() {
    confirmClear = false;
    clearAll();
    await tick();
    document.querySelector<HTMLElement>('.drop')?.focus();
  }

  const sheetEntry = $derived(ui.sheetFor ? app.entries.find((e) => e.id === ui.sheetFor) : undefined);
  const allFiles = $derived(counts.total > 1 ? `les ${counts.total} fichiers` : 'le fichier');

  /** Ferme la feuille, agit, puis rend le focus au bouton « Actions » de la ligne (ou de sa voisine). */
  async function fromSheet(run: () => void) {
    const id = ui.sheetFor;
    const near = id ? rowAround(id) : null;
    rowSheet.hidePopover();
    run();
    await tick();
    const own = id ? document.querySelector<HTMLElement>(`.rows li[data-id="${id}"]`) : null;
    focusRow(own ?? near, '.more');
  }

  function onRowSheetToggle(event: Event) {
    if ((event as ToggleEvent).newState === 'open') rowSheet.querySelector('button')?.focus();
  }
</script>

<svelte:window
  ondragenter={(e) => carriesFiles(e) && dragDepth++}
  ondragleave={(e) => carriesFiles(e) && (dragDepth = Math.max(0, dragDepth - 1))}
  ondragover={(e) => carriesFiles(e) && e.preventDefault()}
  ondrop={onDrop}
  onbeforeunload={onBeforeUnload}
/>

<header class="top">
  <div class="brand" title={modelLabel ? `Nommage par ${modelLabel}` : undefined}>
    <Logo height={22} />
    <span class="product">Renommeur</span>
  </div>
  <div class="meta">
    {#if app.settings?.mock}<span class="badge" title="Noms fictifs : rien n’est envoyé à Claude.">Mode démo</span>{/if}
  </div>
</header>
{#if app.settings?.mock}<p class="demo-band">Mode démo : noms fictifs, rien n’est envoyé à Claude.</p>{/if}

{#snippet langSwitch()}
  <div class="lang">
    <span id="lang-label">Noms en</span>
    <Seg labelledby="lang-label" options={LANG_OPTIONS} value={app.lang} onchange={setLang} />
  </div>
{/snippet}

{#snippet modeSwitch()}
  <span class="visually-hidden" id="mode-label">Traitement</span>
  <!-- Pendant un ZIP, le traitement est figé : noms et contenus sont relus fichier par fichier. -->
  <Seg
    labelledby="mode-label"
    options={MODES}
    value={app.mode}
    onchange={setMode}
    disabled={app.zipping > 0}
    reason="Indisponible pendant la préparation du ZIP"
  />
{/snippet}

{#snippet compressionEditor(id: string)}
  <!-- Échap ferme le panneau depuis n'importe quel segment : écouteur posé sur le groupe. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="cmp-edit" role="group" aria-labelledby="{id}-titre" in:fade={{ duration: 200 }} onkeydown={onCompressionKey}>
    <span class="champ-label" id="{id}-titre">Compression</span>
    <CompressionSettings {id} />
    <button class="btn btn-contour btn-s" onclick={closeCompression}>Terminé</button>
  </div>
{/snippet}

<main class="workspace" class:has-files={hasFiles}>
  <h1 class="visually-hidden">Renommeur</h1>

  {#if app.apiProblem && app.mode !== 'compress'}
    <div class="alert" id="api-alert" role="alert" tabindex="-1">
      <Icon name="alert" size={20} />
      <div class="alert-body">
        <p class="alert-title">Le nommage est indisponible pour le moment.</p>
        <p>Vous pouvez déposer et préparer les fichiers : ils restent dans la liste. Prévenez la personne qui gère l’outil, puis réessayez.</p>
        {#if app.mode === 'both'}
          <p>
            La compression continue : vous pouvez aussi télécharger les images compressées sans les renommer.
            <button class="btn-texte inline" onclick={() => setMode('compress')}>Compresser seulement</button>
          </p>
        {/if}
        <details>
          <summary>Détail technique</summary>
          <p class="tech">{app.apiProblem}{modelLabel ? ` Modèle : ${modelLabel}.` : ''}</p>
        </details>
      </div>
      <button class="btn btn-contour btn-s" aria-busy={checking} onclick={retryApi}>
        <span class="pile"><span class:off={checking}>Réessayer</span><span class:off={!checking}>Vérification…</span></span>
      </button>
    </div>
  {/if}

  {#if !hasFiles}
    <div class="mode-row">
      {@render modeSwitch()}
      <p class="mode-dit" aria-live="polite">{MODE_DIT[app.mode]}</p>
    </div>

    <section class="brief" aria-label="Préparer le lot">
      {#if app.mode === 'compress'}
        <div class="context">
          <div class="context-head"><span class="champ-label" id="cmp-brief">Réglages de compression</span></div>
          <div class="cadre-reglages" role="group" aria-labelledby="cmp-brief" in:fade={{ duration: 200 }}>
            <CompressionSettings id="cmp-vide" aide={false} />
          </div>
          <div class="help">
            {#each AIDE_COMPRESSION as phrase (phrase)}<p>{phrase}</p>{/each}
          </div>
        </div>
      {:else}
        <div class="context">
          <div class="context-head">
            <label class="champ-label" for="context">Contexte du lot</label>
            {@render langSwitch()}
          </div>
          <textarea
            id="context"
            class="champ"
            maxlength="600"
            bind:value={app.context}
            oninput={() => remember('context', app.context)}
            aria-describedby="context-help"
            placeholder="Ex. Boulangerie Martin à Annecy, photos de la vitrine et des produits pour la page Boutique."
          ></textarea>
          <div class="help" id="context-help"><p>Client, lieu, sujet : les mots qui doivent ressortir dans les noms.</p></div>
        </div>
      {/if}
      <div class="drop-wrap">
        <span class="drop-head" aria-hidden="true"></span>
        <button class="drop" onclick={() => picker.click()} aria-describedby="drop-note">
          <span class="drop-main">
            <span class="drop-title point"
              >{#if app.mode === 'compress'}<span class="t-pointer">Déposez vos images</span><span class="t-touch">Choisissez vos images</span
                >{:else}<span class="t-pointer">Déposez vos fichiers</span><span class="t-touch">Choisissez vos fichiers</span>{/if}</span
            >
            <span class="drop-sub"
              ><span class="t-pointer">ou cliquez pour les choisir sur votre poste.</span><span class="t-touch">Touchez pour ouvrir vos fichiers.</span></span
            >
          </span>
          <span class="drop-demo" aria-hidden="true">
            {#if app.mode === 'rename'}
              <s>IMG_2034.JPG</s><b>vitrine-boulangerie-martin-annecy.jpg</b>
            {:else if app.mode === 'compress'}
              <b>IMG_2034.JPG</b><span class="demo-poids"><s>3,4 Mo</s> <b>412 Ko</b></span>
            {:else}
              <span><s>IMG_2034.JPG</s> <s class="demo-poids">3,4 Mo</s></span>
              <span><b>vitrine-boulangerie-martin-annecy.jpg</b> <span class="demo-poids"><b>412 Ko</b></span></span>
            {/if}
          </span>
        </button>
        <div class="drop-foot">
          <p class="drop-note" id="drop-note">{DROP_NOTE[app.mode]}</p>
          {#if app.mode === 'both'}
            {#if editingCompression}
              <div class="cmp-panel">{@render compressionEditor('cmp-vide')}</div>
            {:else}
              <p class="cmp-line">
                <span class="cmp-label">Compression</span><span class="cmp-resume">{resume}</span>
                <button class="btn-texte inline" id="cmp-edit-btn" onclick={openCompression}>Modifier</button>
              </p>
            {/if}
          {/if}
        </div>
      </div>
    </section>
  {:else}
    <section class="brief-compact" data-mode={app.mode} aria-label="Réglages du lot et ajout de fichiers" in:fade={{ duration: 200 }}>
      <div class="mode">{@render modeSwitch()}</div>
      <span class="sep s1" aria-hidden="true"></span>
      {#if app.mode !== 'compress'}
        <div class="ctx">
          {#if editingContext}
            <div class="ctx-edit">
              <label class="champ-label" for="context">Contexte du lot</label>
              <textarea
                id="context"
                class="champ"
                maxlength="600"
                bind:value={app.context}
                oninput={() => remember('context', app.context)}
                onkeydown={(e) => e.key === 'Escape' && (e.preventDefault(), closeContext())}
              ></textarea>
              <button class="btn btn-contour btn-s" onclick={closeContext}>Terminé</button>
            </div>
          {:else}
            <span class="ctx-label">Contexte</span>
            <span class="ctx-text" class:vide={!app.context.trim()} title={app.context.trim() || undefined}
              >{app.context.trim() || 'Aucun contexte : les noms seront plus génériques.'}</span
            >
            <button
              class="btn-texte"
              id="ctx-edit-btn"
              title={app.context.trim() ? undefined : 'Aucun contexte : les noms seront plus génériques.'}
              onclick={openContext}>{app.context.trim() ? 'Modifier' : 'Ajouter un contexte'}</button
            >
          {/if}
        </div>
        <span class="sep s2" aria-hidden="true"></span>
        {@render langSwitch()}
      {/if}
      {#if app.mode !== 'rename'}
        <div class="cmp">
          {#if editingCompression}
            {@render compressionEditor('cmp-bandeau')}
          {:else}
            <span class="cmp-label">Compression</span>
            <span class="cmp-text">{resume}</span>
            <button class="btn-texte" id="cmp-edit-btn" onclick={openCompression}>Modifier</button>
          {/if}
        </div>
      {/if}
      <span class="sep s3" aria-hidden="true"></span>
      <div class="ajouter-cell">
        <button class="btn btn-contour btn-s ajouter" onclick={() => picker.click()}
          ><Icon name="plus" size={16} /><span>Ajouter<span class="ajouter-suite">{' des fichiers'}</span></span></button
        >
      </div>
    </section>

    <section class="files" aria-labelledby="files-title">
      <div class="files-title">
        <h2 id="files-title" class="point" tabindex="-1">{phaseTitle}</h2>
        <div class="clear">
          {#if confirmClear}
            <span id="clear-q">Retirer {allFiles} de la liste ?</span>
            <button class="btn btn-s" aria-describedby="clear-q" onclick={doClear} onkeydown={cancelClearOnEscape}>Retirer {allFiles}</button>
            <button class="btn-texte" id="clear-cancel" aria-describedby="clear-q" onclick={cancelClear} onkeydown={cancelClearOnEscape}>Annuler</button>
          {:else}
            <button class="btn-texte" id="clear-ask" onclick={askClear}>Tout retirer</button>
          {/if}
        </div>
      </div>

      <div class="files-head">
        <div class="tools">
          <div class="filters" role="group" aria-label="Filtrer la liste">
            {#each filters as f (f.key)}
              <button aria-pressed={ui.filter === f.key} onclick={() => pick(f.key)}>{f.label}<span class="n">{f.n}</span></button>
            {/each}
          </div>
        </div>
        <div class="cols" aria-hidden="true">
          <span class="n">N°</span><span></span><span>Fichier</span><span>{app.mode === 'compress' ? 'Poids' : 'Texte alternatif'}</span><span></span>
        </div>
      </div>

      <!-- role="list" : VoiceOver retire sinon le rôle de liste aux listes sans puces. -->
      <ol class="rows" role="list">
        {#each visible as entry (entry.id)}
          <FileRow {entry} n={numbers.get(entry.id) ?? 0} finalName={view.fileNames.get(entry.id)} dupOf={dupOf.get(entry.id)} />
        {:else}
          <li class="none">{EMPTY[ui.filter]} <button class="btn-texte" onclick={() => pick('all')}>Voir tous les fichiers</button></li>
        {/each}
      </ol>
    </section>
  {/if}
  <input bind:this={picker} type="file" multiple hidden onchange={onPick} />
</main>

{#if hasFiles}<ActionBar onshowerrors={showErrors} onshowfailed={showFailed} />{/if}

<div class="toast-zone" class:au-dessus={hasFiles} role="status" aria-live="polite">
  {#if ui.toast}
    {#key ui.toast.id}
      <div
        class="toast"
        class:erreur={ui.toast.tone === 'error'}
        role="presentation"
        onmouseenter={pauseToast}
        onmouseleave={resumeToast}
        onfocusin={pauseToast}
        onfocusout={resumeToast}
        in:fly={{ y: reduceMotion ? 0 : 8, duration: 200, easing: expoOut }}
        out:fade={{ duration: 120 }}
      >
        {#if ui.toast.tone === 'error'}<Icon name="alert" size={16} />{/if}
        <p>{ui.toast.text}</p>
        {#each ui.toast.actions as a (a.label)}
          <button
            class="btn-texte"
            onclick={() => {
              closeToast();
              a.run();
            }}>{a.label}</button
          >
        {/each}
        {#if ui.toast.persist}<button class="fermer" aria-label="Fermer" onclick={closeToast}><Icon name="close" size={16} /></button>{/if}
      </div>
    {/key}
  {/if}
</div>

<div class="sheet" id="row-sheet" popover="auto" bind:this={rowSheet} role="dialog" aria-labelledby="row-sheet-title" ontoggle={onRowSheetToggle}>
  {#if sheetEntry}
    {@const name = view.fileNames.get(sheetEntry.id)}
    <p class="sheet-titre" id="row-sheet-title">{name ?? sheetEntry.file.name}</p>
    {@const pressed = sheetEntry.press !== 'wait' && sheetEntry.press !== 'run'}
    {#if name && (app.mode === 'compress' ? pressed : sheetEntry.status === 'done' && (app.mode === 'rename' || pressed))}
      <button onclick={() => fromSheet(() => downloadOne(outgoing(sheetEntry), name))}
        ><Icon name="download" />{app.mode === 'compress' ? 'Télécharger ce fichier' : 'Télécharger sous ce nom'}</button
      >
    {/if}
    {#if app.mode !== 'compress' && (sheetEntry.status === 'done' || sheetEntry.status === 'error' || (sheetEntry.status === 'ready' && !sheetEntry.attempts))}
      <button onclick={() => fromSheet(() => renameOne(sheetEntry.id))}
        ><Icon name="refresh" />{sheetEntry.status === 'done'
          ? sheetEntry.edited
            ? 'Remplacer votre nom par une nouvelle proposition'
            : 'Proposer un autre nom'
          : 'Nommer ce fichier'}</button
      >
    {/if}
    <button onclick={() => fromSheet(() => removeEntry(sheetEntry.id))}><Icon name="close" />Retirer de la liste</button>
  {/if}
</div>

{#if dragDepth > 0}
  <div class="overlay" aria-hidden="true" in:fade={{ duration: 150 }} out:fade={{ duration: 100 }}>
    <p class="point point-centre" in:fly={{ y: reduceMotion ? 0 : 8, duration: 250, easing: expoOut }}>Lâchez pour ajouter</p>
    <small>{hasFiles ? 'Ils s’ajoutent à la suite de la liste.' : 'Fichiers et dossiers acceptés.'}</small>
  </div>
{/if}

<style>
  /* En-tête */
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s16);
    flex-wrap: wrap;
    row-gap: 0;
    max-width: var(--contenu);
    min-height: 64px;
    margin: 0 auto;
    padding: 0 var(--gutter);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--s12);
    color: var(--noir);
  }

  /* top : aligne « Renommeur » sur la ligne de base du logo, dont le p descend. */
  .product {
    position: relative;
    top: -2px;
    padding-left: var(--s12);
    border-left: 1px solid var(--noir);
    font: 700 var(--t-20) / 1 var(--font-display);
    letter-spacing: -0.01em;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: var(--s24);
    margin-left: auto;
    white-space: nowrap;
  }

  .badge {
    padding: var(--s4) var(--s8);
    background: var(--noir);
    color: var(--blanc);
    font-size: var(--t-12);
    font-weight: 600;
    line-height: 1rem;
  }

  .demo-band {
    display: none;
    margin: 0;
    padding: var(--s8) var(--gutter);
    background: var(--noir);
    color: var(--blanc);
    font-size: var(--t-12);
    font-weight: 500;
    line-height: 1rem;
  }

  .workspace {
    max-width: var(--contenu);
    margin: 0 auto;
    padding: var(--s8) var(--gutter) var(--s64);
  }

  .workspace.has-files {
    padding-bottom: calc(var(--bar-h) + var(--s24) + env(safe-area-inset-bottom));
  }

  /* Bandeau API */
  .alert {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) auto;
    gap: var(--s12) var(--s16);
    align-items: start;
    margin-top: var(--s16);
    padding: var(--s16) var(--s24) var(--s16) var(--s16);
    border: 1px solid var(--rouge);
    background: var(--blanc);
    scroll-margin-top: var(--s16);
  }

  .alert > :global(svg) {
    margin-top: 2px;
    color: var(--rouge);
  }

  .alert-title {
    margin: 0;
    font-weight: 600;
  }

  .alert-body p:not(.alert-title):not(.tech) {
    max-width: 72ch;
    margin: var(--s4) 0 0;
    font-size: var(--t-14);
    color: var(--gris);
  }

  .alert summary {
    display: inline-flex;
    align-items: center;
    gap: var(--s8);
    min-height: 36px;
    list-style: none;
    font-size: var(--t-14);
    text-decoration: underline 1px;
    text-underline-offset: 4px;
    cursor: pointer;
  }

  .alert summary::-webkit-details-marker {
    display: none;
  }

  /* Triangle de dépliage : remplace le marqueur natif retiré par inline-flex. */
  .alert summary::before {
    content: '';
    border-block: 4px solid transparent;
    border-left: 6px solid currentColor;
  }

  .alert details[open] summary::before {
    rotate: 90deg;
  }

  @media (min-width: 720px) {
    .alert > .btn {
      margin-top: -6px;
    }
  }

  .alert .tech {
    margin: 0;
    font: 400 var(--t-12) / 1.5 var(--font-mono);
    color: var(--gris);
    overflow-wrap: anywhere;
  }

  /* État vide : cadres alignés par subgrid */
  .brief {
    display: grid;
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
    grid-template-rows: auto minmax(240px, auto) auto;
    column-gap: var(--s32);
    row-gap: var(--s8);
    margin-top: var(--s24);
  }

  .context,
  .drop-wrap {
    display: grid;
    grid-row: span 3;
    grid-template-rows: subgrid;
  }

  .context-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--s8) var(--s16);
    min-height: 36px;
  }

  .context textarea {
    height: 100%;
    padding: var(--s12) var(--s16);
    font-size: var(--t-16);
    line-height: 1.5;
    resize: none;
  }

  .help,
  .drop-note {
    margin: 0;
    font-size: var(--t-14);
    color: var(--gris);
  }

  .help p {
    margin: 0;
  }

  /* Plusieurs phrases d'aide (Compresser) : des paragraphes, pas un bloc. */
  .help p + p {
    margin-top: var(--s8);
  }

  /* Traitement : la première décision, au-dessus du contexte et du dépôt. */
  .mode-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s8) var(--s24);
    margin-top: var(--s32);
  }

  .alert + .mode-row {
    margin-top: var(--s24);
  }

  /*
   * Changer de mode ne fait pas sauter la page : base fixe (la phrase passe sous le sélecteur
   * à la même largeur dans les trois modes) et deux lignes réservées, trois sous 720 px.
   */
  .mode-dit {
    flex: 1 1 28rem;
    min-height: 40px;
    margin: 0;
    max-width: 72ch;
    font-size: var(--t-14);
    line-height: 20px;
    color: var(--gris);
  }

  .cadre-reglages {
    grid-row: 2;
    padding: var(--s24);
    border: 1px solid var(--filet);
    background: var(--blanc);
  }

  .drop-foot {
    grid-row: 3;
    display: grid;
    align-content: start;
    gap: var(--s12);
  }

  .cmp-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s4) var(--s12);
    margin: 0;
    font-size: var(--t-14);
    line-height: 20px;
  }

  .cmp-label {
    flex: none;
    font-weight: 600;
  }

  .cmp-resume {
    color: var(--gris);
  }

  .cmp-panel {
    padding: var(--s16);
    background: var(--blanc);
  }

  .cmp-edit {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--s12) var(--s16);
  }

  .cmp-edit .champ-label {
    grid-column: 1 / -1;
  }

  .demo-poids {
    font: 500 var(--t-12) / 16px var(--font-text);
    font-variant-numeric: tabular-nums;
    color: var(--gris);
  }

  .demo-poids b {
    font-weight: 600;
    color: var(--noir);
  }

  .lang {
    display: flex;
    align-items: center;
    gap: var(--s8);
    font-size: var(--t-14);
    color: var(--gris);
  }

  .drop {
    grid-row: 2;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: var(--s24);
    padding: var(--s32);
    border: 1px solid var(--trait);
    background: var(--blanc);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--vite) var(--courbe),
      box-shadow var(--vite) var(--courbe);
  }

  .drop:hover {
    border-color: var(--noir);
    box-shadow: inset 0 0 0 1px var(--noir);
  }

  .drop:active {
    background: var(--survol);
  }

  .drop-main {
    align-self: center;
    display: grid;
    gap: var(--s8);
  }

  .drop-title {
    font: 700 var(--t-32) / 1.1 var(--font-display);
    letter-spacing: -0.015em;
  }

  .drop-title::after {
    transform-origin: left bottom;
  }

  .drop-sub {
    color: var(--gris);
    text-wrap: pretty;
  }

  .drop-demo {
    display: grid;
    gap: 2px;
    font: 400 var(--t-13) / 1.4 var(--font-mono);
    color: var(--gris);
  }

  .drop-demo s {
    text-decoration: line-through 1px color-mix(in srgb, var(--gris) 70%, transparent);
  }

  .drop-demo b {
    color: var(--noir);
    font-weight: 600;
    overflow-wrap: anywhere;
  }


  .t-touch {
    display: none;
  }

  @media (hover: none) {
    .t-pointer {
      display: none;
    }

    .t-touch {
      display: inline;
    }
  }

  /* Bandeau replié : traitement, contexte, langue, ajout ; la compression en seconde ligne en « Les deux ». */
  .brief-compact {
    display: grid;
    grid-template-columns: auto 1px minmax(0, 1fr) 1px auto 1px auto;
    grid-template-areas:
      'mode s1 ctx s2 lang s3 ajouter'
      '. . cmp cmp cmp cmp cmp';
    align-items: start;
    column-gap: var(--s16);
    margin-top: var(--s8);
    padding: var(--s8) var(--s8) var(--s8) var(--s16);
    background: var(--blanc);
    font-size: var(--t-14);
  }

  .brief-compact[data-mode='rename'] {
    grid-template-areas: 'mode s1 ctx s2 lang s3 ajouter';
  }

  .brief-compact[data-mode='compress'] {
    grid-template-areas: 'mode s1 cmp cmp cmp s3 ajouter';
  }

  .alert + .brief-compact {
    margin-top: var(--s16);
  }

  .mode {
    grid-area: mode;
    display: flex;
    align-items: center;
    min-height: 40px;
  }

  .s1 {
    grid-area: s1;
  }

  .s2 {
    grid-area: s2;
  }

  .s3 {
    grid-area: s3;
  }

  .brief-compact .lang {
    grid-area: lang;
    min-height: 40px;
  }

  .ajouter-cell {
    grid-area: ajouter;
    display: flex;
    align-items: center;
    min-height: 40px;
  }

  .cmp {
    grid-area: cmp;
    display: flex;
    align-items: center;
    gap: var(--s16);
    min-width: 0;
    min-height: 40px;
  }

  .brief-compact[data-mode='both'] .cmp {
    border-top: 1px solid var(--filet);
  }

  /* Jamais d'ellipse : le résumé est toute l'information. */
  .cmp-text {
    flex: 1;
    min-width: 0;
    color: var(--gris);
    text-wrap: pretty;
  }

  .cmp .cmp-edit {
    padding: var(--s12) 0;
  }

  .ctx {
    grid-area: ctx;
    display: flex;
    align-items: center;
    gap: var(--s16);
    min-width: 0;
    min-height: 40px;
  }

  .ctx-label {
    flex: none;
    font-weight: 600;
  }

  .ctx-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--gris);
  }

  /* Le bouton « Ajouter un contexte » dit déjà l'essentiel (la phrase est dans son infobulle) ; coupée, elle ne voudrait plus rien dire. */
  .ctx-text.vide {
    display: none;
  }

  .sep {
    width: 1px;
    height: 24px;
    margin-top: var(--s8);
    background: var(--filet);
  }

  /* 1024 à 1279 px : le texte du contexte garde sa place. */
  @media (max-width: 1279px) {
    .brief-compact:not([data-mode='compress']) .ajouter-suite,
    .brief-compact .lang > span:first-child {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  }

  .ctx-edit {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s8) var(--s12);
    align-items: end;
    padding: var(--s8) 0;
  }

  .ctx-edit .champ-label {
    grid-column: 1 / -1;
  }

  .ctx-edit textarea {
    height: 96px;
    padding: var(--s8) var(--s12);
    font-size: var(--t-16);
    line-height: 1.5;
    resize: none;
  }

  /* Liste */
  .files {
    margin-top: var(--s48);
  }

  .files-title {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s16);
    margin-bottom: var(--s16);
  }

  .files-title h2 {
    font-size: var(--t-32);
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .clear {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--s8) var(--s16);
    font-size: var(--t-14);
    color: var(--gris);
  }

  .clear .btn-texte {
    color: var(--gris);
  }

  .clear .btn-texte:hover {
    color: var(--noir);
  }

  .files-head {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--fond);
  }

  .tools {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: var(--s16);
    min-height: 52px;
    border-bottom: 1px solid var(--noir);
  }

  .filters {
    display: flex;
    gap: var(--s24);
  }

  .filters button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--s4);
    min-height: 52px;
    padding: 0;
    border: 0;
    background: none;
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--gris);
    white-space: nowrap;
    cursor: pointer;
    transition: color var(--vite) var(--courbe);
  }

  .filters .n {
    font-weight: 500;
    color: var(--gris-doux);
    font-variant-numeric: tabular-nums;
  }

  .filters button:hover,
  .filters button[aria-pressed='true'] {
    color: var(--noir);
  }

  /* Barre posée sur le filet ; une bordure plutôt qu'un fond, visible en couleurs forcées. */
  .filters button[aria-pressed='true']::after {
    content: '';
    position: absolute;
    inset: auto 0 -1px;
    height: 0;
    border-top: 3px solid var(--noir);
  }

  .cols {
    display: grid;
    grid-template-columns: 32px 48px minmax(0, 5fr) minmax(0, 4fr) 124px;
    column-gap: var(--s16);
    padding: var(--s8) var(--s16);
    font-size: var(--t-12);
    font-weight: 500;
    line-height: 1rem;
    color: var(--gris);
  }

  .cols .n {
    text-align: right;
  }

  .rows {
    margin: 0;
    padding: 0;
    list-style: none;
    background: var(--blanc);
  }

  .none {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s8) var(--s16);
    padding: var(--s32) var(--s16);
    font-size: var(--t-14);
    color: var(--gris);
  }

  .none .btn-texte {
    color: var(--noir);
  }

  /* Voile de dépôt */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-content: center;
    gap: var(--s16);
    pointer-events: none;
    text-align: center;
    color: var(--blanc);
    background-color: var(--noir);
    background-image: radial-gradient(var(--trame-sur-noir) 1px, transparent 1.3px);
    background-size: 24px 24px;
  }

  .overlay p {
    margin: 0;
    font: 700 var(--t-64) / 1 var(--font-display);
    letter-spacing: -0.025em;
  }

  .overlay small {
    font-size: var(--t-16);
    color: var(--blanc-72);
  }

  /* Toasts */
  .toast-zone {
    position: fixed;
    z-index: 30;
    left: max(var(--gutter), calc((100vw - var(--contenu)) / 2 + var(--gutter)));
    bottom: calc(var(--s24) + env(safe-area-inset-bottom));
  }

  .toast-zone.au-dessus {
    bottom: calc(var(--bar-h) + var(--s16) + env(safe-area-inset-bottom));
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--s16);
    min-height: 48px;
    max-width: min(560px, 100vw - 2 * var(--gutter));
    padding: var(--s8) var(--s8) var(--s8) var(--s16);
    background: var(--noir);
    color: var(--blanc);
    font-size: var(--t-14);
  }

  .toast:not(:has(button)) {
    padding-right: var(--s16);
  }

  .toast p {
    flex: 1;
    margin: 0;
  }

  .toast > :global(svg) {
    flex: none;
    color: var(--rouge);
  }

  .toast .btn-texte {
    flex: none;
    color: var(--blanc);
  }

  .toast .fermer {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--blanc);
    cursor: pointer;
  }

  .toast :focus-visible {
    outline-color: var(--blanc);
  }

  @media (prefers-reduced-motion: no-preference) {
    .drop-title::after {
      transition: transform var(--vite) var(--courbe);
    }

    .drop:hover .drop-title::after {
      transform: scale(1.4);
    }
  }

  @media (max-width: 1023px) {
    .brief {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      row-gap: var(--s24);
    }

    .context {
      grid-row: auto;
      grid-template-rows: auto minmax(120px, auto) auto;
      row-gap: var(--s8);
    }

    .drop-wrap {
      grid-row: auto;
      display: flex;
      flex-direction: column;
      gap: var(--s8);
    }

    .drop-head {
      display: none;
    }

    .drop {
      min-height: 200px;
    }

    .cols {
      display: none;
    }

    .brief-compact {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'mode mode' 'ctx ctx' 'lang ajouter' 'cmp cmp';
      row-gap: var(--s8);
      padding: var(--s12);
    }

    .brief-compact[data-mode='rename'] {
      grid-template-areas: 'mode mode' 'ctx ctx' 'lang ajouter';
    }

    .brief-compact[data-mode='compress'] {
      grid-template-areas: 'mode mode' 'cmp cmp' 'ajouter ajouter';
    }

    .sep {
      display: none;
    }

    .brief-compact[data-mode='both'] .cmp {
      padding-top: var(--s8);
    }

    /* Libellé et « Modifier » sur une ligne, puis le résumé entier dessous. */
    .cmp {
      flex-wrap: wrap;
      row-gap: 0;
    }

    .cmp .btn-texte {
      margin-left: auto;
    }

    .cmp-text {
      order: 1;
      flex-basis: 100%;
    }

    .cmp-edit {
      grid-template-columns: minmax(0, 1fr);
    }

    .cmp-edit .btn {
      justify-self: start;
    }
  }

  @media (max-width: 719px) {
    .alert {
      grid-template-columns: 20px minmax(0, 1fr);
    }

    .alert .btn {
      grid-column: 2;
      justify-self: start;
    }

    .drop {
      padding: var(--s24);
    }

    .drop-title {
      font-size: var(--t-24);
    }

    .mode-row :global(.seg),
    .mode :global(.seg) {
      width: 100%;
    }

    .mode-row :global(.seg button),
    .mode :global(.seg button) {
      flex: 1;
      min-width: 0;
      padding: 0 var(--s8);
    }

    .mode {
      width: 100%;
    }

    .mode-dit {
      min-height: 60px;
    }

    .ajouter-cell .btn {
      flex: 1;
      min-height: 44px;
    }

    .files-title h2 {
      font-size: var(--t-24);
    }

    /* « Tout retirer » passe dans la feuille de la barre. */
    .clear {
      display: none;
    }

    .filters {
      overflow-x: auto;
      scrollbar-width: none;
    }

    .filters button {
      flex: none;
      min-height: 44px;
    }

    .tools {
      min-height: 44px;
    }

    .overlay p {
      font-size: var(--t-48);
    }

    .toast-zone {
      left: var(--gutter);
      right: var(--gutter);
    }

    .toast {
      max-width: none;
      flex-wrap: wrap;
    }
  }

  @media (max-width: 479px) {
    .brand {
      gap: var(--s8);
    }

    .brand :global(svg) {
      height: 20px;
    }

    .product {
      padding-left: var(--s8);
      font-size: var(--t-16);
    }

    .meta {
      gap: var(--s16);
    }

    .ajouter-suite {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    .badge {
      display: none;
    }

    .demo-band {
      display: block;
    }
  }
</style>
