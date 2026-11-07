<script lang="ts">
  import { app, setCompression } from '../lib/store.svelte';
  import type { Squeeze } from '../lib/compress/settings';
  import { AIDE_COMPRESSION, LEVEL_LABEL } from '../lib/format';
  import Seg from './Seg.svelte';

  let { id, aide = true }: { id: string; aide?: boolean } = $props();

  const LEVEL: { v: Squeeze['level']; l: string }[] = (['legere', 'equilibree', 'forte'] as const).map((v) => ({ v, l: LEVEL_LABEL[v] }));
  const SIDE: { v: Squeeze['maxSide']; l: string }[] = [
    { v: 1280, l: '1280 px' },
    { v: 1920, l: '1920 px' },
    { v: 2560, l: '2560 px' },
    { v: 0, l: 'Sans limite' },
  ];
  const FORMAT: { v: Squeeze['format']; l: string }[] = [
    { v: 'auto', l: 'Automatique' },
    { v: 'keep', l: 'D’origine' },
    { v: 'webp', l: 'WebP' },
  ];
</script>

<div class="reglages">
  <div class="reglage">
    <span class="champ-label" id="{id}-niveau">Niveau</span>
    <Seg labelledby="{id}-niveau" options={LEVEL} value={app.squeeze.level} onchange={(v) => setCompression({ level: v })} />
  </div>
  <div class="reglage">
    <span class="champ-label" id="{id}-cote">Côté le plus long</span>
    <Seg labelledby="{id}-cote" options={SIDE} value={app.squeeze.maxSide} onchange={(v) => setCompression({ maxSide: v })} />
  </div>
  <div class="reglage">
    <span class="champ-label" id="{id}-format">Format</span>
    <Seg labelledby="{id}-format" options={FORMAT} value={app.squeeze.format} onchange={(v) => setCompression({ format: v })} />
  </div>
  {#if aide}
    {#each AIDE_COMPRESSION as phrase (phrase)}<p class="aide">{phrase}</p>{/each}
  {/if}
</div>

<style>
  .reglages {
    container-type: inline-size;
    display: grid;
    gap: var(--s12);
  }

  /* Libellé au-dessus du groupe ; à côté dès que la place le permet. */
  .reglage {
    display: grid;
    justify-items: start;
    gap: var(--s8);
  }

  @container (min-width: 500px) {
    .reglage {
      grid-template-columns: 136px auto;
      align-items: center;
      gap: var(--s16);
    }
  }

  .aide {
    margin: 0;
    max-width: 72ch;
    font-size: var(--t-14);
    line-height: 20px;
    color: var(--gris);
  }
</style>
