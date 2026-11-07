<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError } from '../lib/api';
  import { app, login } from '../lib/store.svelte';
  import Logo from './Logo.svelte';
  import Icon from './Icon.svelte';

  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let input: HTMLInputElement;

  function messageFor(e: unknown): string {
    if (!(e instanceof ApiError)) return 'Connexion impossible. Réessayez dans un instant.';
    if (e.status === 401) return 'Mot de passe incorrect. Vérifiez les majuscules, puis réessayez.';
    if (e.status === 0) return 'Le serveur ne répond pas. Vérifiez la connexion, puis réessayez.';
    // 429 : « Trop de tentatives. Réessayez dans N min. », rédigé par le serveur.
    return e.message;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      error = 'Saisissez le mot de passe de l’équipe.';
      input.focus();
      return;
    }
    busy = true;
    error = '';
    try {
      await login(password);
    } catch (e) {
      error = messageFor(e);
      password = '';
      await tick();
      input.focus();
    } finally {
      busy = false;
    }
  }
</script>

<header class="splash-top"><Logo height={28} /></header>
<main class="splash">
  <h1 class="point point-centre">Renommeur</h1>
  <p class="lede">Des noms de fichiers propres pour le web.</p>
  {#if app.entries.length > 0}
    <!-- Session expirée ou déconnexion en cours de lot : la liste est gardée en mémoire. -->
    <p class="lede">
      {app.entries.length > 1 ? `Vos ${app.entries.length} fichiers sont` : 'Votre fichier est'} toujours là : reconnectez-vous pour reprendre.
    </p>
  {:else}
    <p class="demo" aria-hidden="true"><s>IMG_2034.JPG</s><b>vitrine-boulangerie-martin-annecy.jpg</b></p>
    <p class="visually-hidden">Exemple : IMG_2034.JPG devient vitrine-boulangerie-martin-annecy.jpg.</p>
  {/if}

  <form onsubmit={submit} novalidate>
    <label class="champ-label" for="password">Mot de passe de l’équipe</label>
    <div class="field">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:this={input}
        id="password"
        type="password"
        autocomplete="current-password"
        bind:value={password}
        autofocus
        oninput={() => error && (error = '')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'login-error' : undefined}
      />
      <button class="btn" type="submit" aria-busy={busy}>
        <span class="pile"><span class:off={busy}>Se connecter</span><span class:off={!busy}>Connexion…</span></span>
      </button>
    </div>
    <!-- Toujours présent : l'apparition du message ne fait pas descendre le pied de page. -->
    <p class="error" id="login-error" role="alert">{#if error}<Icon name="alert" size={16} />{error}{/if}</p>
  </form>

  <p class="foot">
    Outil interne Pixim. Les fichiers restent sur votre poste : seuls leur nom, un aperçu réduit et un court extrait partent vers Claude pour le nommage.
  </p>
</main>

<style>
  .lede {
    max-width: 34ch;
    margin: var(--s16) 0 0;
    color: var(--gris);
  }

  .demo {
    display: grid;
    gap: var(--s4);
    margin: var(--s24) 0 0;
    font: 400 var(--t-13) / 1.4 var(--font-mono);
    overflow-wrap: anywhere;
  }

  .demo s {
    color: var(--gris);
    text-decoration: line-through 1px color-mix(in srgb, var(--gris) 70%, transparent);
  }

  .demo b {
    font-weight: 600;
  }

  /* Formulaire classique : libellé et message alignés à gauche, au-dessus du champ. */
  form {
    width: 100%;
    margin-top: var(--s48);
    text-align: left;
  }

  form .champ-label {
    margin-bottom: var(--s8);
  }

  .field {
    display: flex;
  }

  .field:focus-within {
    outline: 2px solid var(--noir);
    outline-offset: 2px;
  }

  input {
    flex: 1;
    min-width: 0;
    height: 52px;
    padding: 0 var(--s16);
    border: 1px solid var(--trait);
    border-right: 0;
    background: var(--blanc);
    font-size: var(--t-16);
    text-align: left;
    transition: border-color var(--vite) var(--courbe);
  }

  input:hover {
    border-color: var(--gris);
  }

  input:focus {
    outline: none;
    border-color: var(--noir);
  }

  input[aria-invalid='true'] {
    border-color: var(--rouge);
    box-shadow: inset 0 0 0 1px var(--rouge);
  }

  .field .btn {
    min-width: 168px;
    min-height: 52px;
  }

  .field .btn:focus-visible {
    outline: 2px solid var(--blanc);
    outline-offset: -6px;
  }

  .error {
    min-height: 1.5em;
    display: flex;
    align-items: center;
    gap: var(--s8);
    margin: var(--s12) 0 0;
    font-size: var(--t-14);
    font-weight: 600;
    color: var(--rouge);
  }

  .foot {
    max-width: 44ch;
    margin: var(--s32) 0 0;
    font-size: var(--t-12);
    color: var(--gris);
    text-wrap: balance;
  }

  @media (max-width: 479px) {
    .field .btn {
      min-width: 0;
      padding: 0 var(--s16);
    }
  }
</style>
