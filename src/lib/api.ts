export interface Settings {
  version: string;
  model: string;
  batchSize: number;
  mock: boolean;
  keyConfigured: boolean;
}

export interface NamedFile {
  id: string;
  name: string;
  alt: string;
}

export interface NamingItem {
  id: string;
  kind: string;
  name: string;
  image?: string;
  text?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Message d'une réponse sans corps JSON. 502, 503 et 504 viennent alors de la passerelle et non de
 * l'API : en local, c'est le proxy de Vite qui ne trouve pas le serveur PHP.
 */
function fallbackMessage(status: number): string {
  if (status < 502 || status > 504) return `Erreur ${status}.`;
  return import.meta.env.DEV
    ? `Le serveur PHP de l’API ne répond pas (erreur ${status}) : relancez « npm run dev », qui le démarre, ou « npm run api ».`
    : `Le serveur de l’API ne répond pas (erreur ${status}). Réessayez dans un instant.`;
}

async function call<T>(path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(
      controller.signal.aborted ? 'Le serveur met trop de temps à répondre.' : 'Serveur injoignable.',
      0,
      'network',
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error ?? {};
    throw new ApiError(
      error.message ?? fallbackMessage(response.status),
      response.status,
      error.code ?? 'http',
      error.retryable ?? (response.status >= 500 || response.status === 429),
    );
  }
  return data as T;
}

export const api = {
  session: () => call<{ authenticated: boolean; settings?: Settings }>('session.php'),
  login: (password: string) => call<{ ok: true }>('login.php', { password }),
  logout: () => call<{ ok: true }>('logout.php', {}),
  ping: () => call<{ ok: boolean; reason?: string; mock?: boolean }>('ping.php', {}, 20_000),
  name: (context: string, lang: 'fr' | 'en', items: NamingItem[]) =>
    call<{ files: NamedFile[]; mock?: boolean }>('name.php', { context, lang, items }, 150_000),
};
