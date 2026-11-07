<script lang="ts">
  type Name = 'download' | 'refresh' | 'close' | 'alert' | 'plus' | 'more';
  let { name, size = 18 }: { name: Name; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true">
  {#if name === 'download'}
    <path d="M12 3v12M6.5 9.5 12 15l5.5-5.5M4 20h16" />
  {:else if name === 'refresh'}
    <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
  {:else if name === 'close'}
    <path d="m6 6 12 12M18 6 6 18" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'more'}
    <g fill="currentColor" stroke="none"><rect x="4" y="10.5" width="3" height="3" /><rect x="10.5" y="10.5" width="3" height="3" /><rect x="17" y="10.5" width="3" height="3" /></g>
  {:else}
    <path d="M12 8v5M12 16.5v.5M3 20 12 4l9 16H3Z" />
  {/if}
</svg>
