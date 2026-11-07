<script lang="ts">
  import { app, loadSession } from './lib/store.svelte';
  import Login from './components/Login.svelte';
  import Workspace from './components/Workspace.svelte';
  import Logo from './components/Logo.svelte';

  void loadSession();
</script>

{#if app.fatal}
  <header class="splash-top"><Logo height={28} /></header>
  <main class="splash">
    <h1 class="point point-centre">Renommeur</h1>
    <p class="fatal">{app.fatal}</p>
    <button class="btn" onclick={() => location.reload()}>Réessayer</button>
  </main>
{:else if app.auth === 'in'}
  <Workspace />
{:else if app.auth === 'out'}
  <Login />
{/if}

<style>
  .fatal {
    max-width: 40ch;
    margin: var(--s24) 0 var(--s32);
    color: var(--gris);
  }
</style>
