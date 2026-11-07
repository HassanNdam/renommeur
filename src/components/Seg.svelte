<script lang="ts" generics="T extends string | number">
  import { tick } from 'svelte';

  interface Option {
    v: T;
    l: string;
    /** Nom accessible quand le libellé visible ne suffit pas ; il contient toujours ce libellé. */
    name?: string;
  }
  let {
    options,
    value,
    onchange,
    labelledby,
    fill = false,
    disabled = false,
    reason,
  }: {
    options: readonly Option[];
    value: T;
    onchange: (v: T) => void;
    labelledby: string;
    fill?: boolean;
    /** Indisponible : même apparence, rien ne change ; aria-disabled garde le focus et l'infobulle. */
    disabled?: boolean;
    /** Infobulle des segments quand le groupe est indisponible. */
    reason?: string;
  } = $props();

  const STEP: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

  async function onkeydown(event: KeyboardEvent) {
    const n = options.length;
    const i = options.findIndex((o) => o.v === value);
    let next: number;
    if (event.key in STEP) next = (i + STEP[event.key] + n) % n;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else return;
    event.preventDefault(); // même indisponible : la flèche ne fait pas défiler la page
    if (disabled) return;
    const group = event.currentTarget as HTMLElement; // lu avant await : currentTarget redevient null
    onchange(options[next].v);
    await tick();
    group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }
</script>

<div class="seg" class:fill role="radiogroup" tabindex="-1" aria-labelledby={labelledby} {onkeydown}>
  {#each options as o (o.v)}
    <button
      type="button"
      role="radio"
      aria-checked={o.v === value}
      aria-disabled={disabled || undefined}
      tabindex={o.v === value ? 0 : -1}
      aria-label={o.name}
      title={disabled ? (reason ?? o.name) : o.name}
      onclick={() => disabled || onchange(o.v)}>{o.l}</button
    >
  {/each}
</div>

<style>
  .seg {
    display: flex;
  }

  .fill {
    width: 100%;
  }

  .fill button {
    flex: 1;
    min-width: 0;
    padding: 0 var(--s8);
  }

  button {
    min-width: 44px;
    height: 36px;
    padding: 0 var(--s12);
    border: 1px solid var(--trait);
    background: var(--blanc);
    color: var(--noir);
    font-size: var(--t-14);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--vite) var(--courbe),
      border-color var(--vite) var(--courbe),
      color var(--vite) var(--courbe);
  }

  button + button {
    margin-left: -1px;
  }

  /* :where : la spécificité reste celle de button:hover, le segment coché garde son bord noir. */
  button:hover:not(:where([aria-disabled='true'])) {
    position: relative;
    border-color: var(--gris);
  }

  /* Indisponible : rien n'est grisé, seul le curseur le dit (et l'infobulle). */
  button[aria-disabled='true'] {
    cursor: not-allowed;
  }

  button[aria-checked='true'] {
    position: relative;
    border-color: var(--noir);
    background: var(--noir);
    color: var(--blanc);
  }

  button:focus-visible {
    position: relative;
    z-index: 1;
  }

  @media (forced-colors: active) {
    button[aria-checked='true'] {
      forced-color-adjust: none;
      border-color: Highlight;
      background: Highlight;
      color: HighlightText;
    }
  }

  @media (max-width: 719px) {
    button {
      height: 44px;
    }
  }
</style>
