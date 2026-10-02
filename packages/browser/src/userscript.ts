// hihyou as a userscript (Tampermonkey, Violentmonkey): the extension's content script, with the userscript
// manager standing in for the background worker. The app is bundled into the same file, so nothing is loaded
// from anywhere at run time.
import { start } from "./content.js";
import { fetchable } from "./privileged.js";

/** The subset of the managers' GM_xmlhttpRequest this script uses; both spell it the same way. */
interface XhrDetails {
  method: "GET";
  url: string;
  headers?: Record<string, string>;
  responseType: "arraybuffer";
  /** false: send the reviewer's github.com cookies, so a private repository works for whoever is signed in. */
  anonymous: false;
  onload(response: XhrResponse): void;
  onerror(response: Partial<XhrResponse> & { error?: string }): void;
  ontimeout(): void;
}
interface XhrResponse {
  status: number;
  statusText: string;
  response: ArrayBuffer | null;
  finalUrl: string;
}
declare const GM_xmlhttpRequest: ((details: XhrDetails) => void) | undefined;
declare const GM:
  | { xmlHttpRequest?: (details: XhrDetails) => void }
  | undefined;

function request(details: XhrDetails) {
  if (typeof GM_xmlhttpRequest === "function")
    return GM_xmlhttpRequest(details);
  if (typeof GM === "object" && typeof GM?.xmlHttpRequest === "function")
    return GM.xmlHttpRequest(details);
  throw new Error(
    "the userscript manager grants no GM_xmlhttpRequest; check that the script's @grant lines survived the install",
  );
}

start({
  fetch(url, init) {
    // The manager's request carries the github.com cookies to any host @connect allows, so the allowlist is
    // enforced here, before anything leaves.
    if (!fetchable.test(url))
      return Promise.reject(
        new Error(`refusing to fetch ${url}: only https://github.com/ URLs`),
      );
    return new Promise<Response>((resolve, reject) =>
      request({
        method: "GET",
        url,
        ...(init?.accept && { headers: { Accept: init.accept } }),
        responseType: "arraybuffer",
        anonymous: false,
        onload: (r) => {
          const empty = r.status === 204 || r.status === 304;
          resolve(
            new Response(empty ? null : r.response, {
              status: r.status,
              statusText: r.statusText,
            }),
          );
        },
        onerror: (r) =>
          reject(
            new Error(
              `fetch ${url}: ${r.error ?? `network error (status ${r.status ?? "none"}, final URL ${r.finalUrl ?? "unknown"})`}`,
            ),
          ),
        ontimeout: () => reject(new Error(`fetch ${url}: timed out`)),
      }),
    );
  },
  loadApp: () => import("./app.js").then((m) => m.app),
});
