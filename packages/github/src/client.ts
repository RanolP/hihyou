/** A thin `fetch` wrapper: GitHub auth headers in, a typed JSON body out, a self-diagnosing error on failure. */
export interface GitHubClientOptions {
  token: string;
  /** Defaults to the global `fetch`; pass a stub in tests or a wrapped client elsewhere. */
  fetch?: typeof fetch;
  /** Defaults to the public API; github.com only (see `parseGitHubRemote`). */
  apiBase?: string;
}

export interface GitHubClient {
  get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T>;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const apiBase = options.apiBase ?? "https://api.github.com";
  const doFetch = options.fetch ?? fetch;
  return {
    async get<T>(
      path: string,
      params?: Record<string, string | number | boolean | undefined>,
    ): Promise<T> {
      const url = new URL(apiBase + path);
      for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      const response = await doFetch(url, {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `GET ${url} -> ${response.status} ${response.statusText}: ${body}`,
        );
      }
      return (await response.json()) as T;
    },
  };
}
