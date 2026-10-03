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
  /** A GraphQL query or mutation's `data`; GitHub's `errors`, which arrive with a 200, throw. */
  graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const apiBase = options.apiBase ?? "https://api.github.com";
  const doFetch = options.fetch ?? fetch;
  return {
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      const url = `${apiBase}/graphql`;
      const response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });
      const text = await response.text();
      if (!response.ok)
        throw new Error(
          `POST ${url} -> ${response.status} ${response.statusText}: ${text}`,
        );
      const json = JSON.parse(text) as {
        data?: T;
        errors?: { message: string }[];
      };
      if (json.errors?.length || json.data === undefined)
        throw new Error(
          `POST ${url} (${query.trim().split(/\s+/, 2).join(" ")}): ${
            json.errors?.map((e) => e.message).join("; ") ?? text
          }`,
        );
      return json.data;
    },
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
