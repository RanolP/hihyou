# Release the browser extension

Upload the extension to the Chrome Web Store and Firefox Add-ons manually once. The release workflow can then build both archives, attach them to a GitHub release, and submit both store updates.

## Configure the store secrets

For Chrome Web Store API v2, enable the Chrome Web Store API in a Google Cloud project and create a service account by following the [Chrome Web Store service-account guide](https://developer.chrome.com/docs/webstore/service-accounts). Add the service account in the developer dashboard's account settings. When the guide reaches **Obtain access tokens**, follow **Use a JSON Web Token** and stop after downloading the JSON file.

Configure these GitHub Actions secrets:

- `CHROME_EXTENSION_ID`: the extension ID shown under the extension name in the Chrome Web Store developer dashboard.
- `CHROME_PUBLISHER_ID`: the publisher ID in the developer dashboard URL after selecting the correct publisher.
- `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`: the JSON service-account key's `client_email` value.
- `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`: the JSON service-account key's `private_key` value without its surrounding quotes, preserving the `\n` sequences.
- `FIREFOX_EXTENSION_ID`: the extension ID from the Firefox Add-ons listing.
- `FIREFOX_JWT_ISSUER`: the issuer from an AMO API key.
- `FIREFOX_JWT_SECRET`: the secret from the same AMO API key.

## Release a version

Update `packages/browser/package.json` to version `X.Y.Z`, then push the tag `browser-vX.Y.Z`.
