# Security

A public web app that opens any URL in a browser on its own servers has three
obvious ways to go wrong: it can be pointed at its own network, it can run the
target site's code in its own origin, and it can leak what the user gave it.

## Server-side request forgery

`lib/ssrf.ts`.

- A scanned URL must be http(s), carry no credentials, and resolve (every
  address) to a public IP. Loopback, private, link-local (including the
  169.254.169.254 metadata address), carrier-grade NAT, documentation,
  multicast, and reserved ranges are refused, for IPv4 and IPv6, including
  IPv4-mapped IPv6. Names like `localhost`, `*.local`, `*.internal` are refused
  outright.
- Inside Chromium, request interception applies the same check to every
  subresource the page asks for, so a public page can't make the server's
  browser fetch an internal address.
- Replaying a feed checks the host before each request and does not follow
  redirects, so a public endpoint can't bounce the fetcher inward.

Residual risk: DNS rebinding between the check and the connection. Lookups are
cached per function instance, which narrows the window.

## The target site's code

The snapshot has all scripts, event handlers, frames, and `javascript:` URLs
removed on the server, then a Content-Security-Policy that allows only the
engine script (by nonce) and blocks all network connections from script
(`connect-src 'none'`). It is shown in `<iframe sandbox="allow-scripts">`
without `allow-same-origin`, so even a script that slipped through would run in
an opaque origin with no access to the app's cookies, storage, or DOM. The app
accepts `postMessage` only from that iframe's own window.

## What the user gives us

- **Pasted cookies** are set only for the target host, used for that scan (and
  a crawl started from it), and never stored, logged, or returned. They can
  appear inside a feed token, which is sealed.
- **Feed tokens** are AES-256-GCM sealed with `SCRAPE_SECRET` and expire after
  six hours. The browser can neither read them (they may hold cookies) nor
  alter them (to aim the fetcher at another host). Production refuses to run
  without the secret.
- **Recipes** are stored in the user's browser and never include cookies or
  tokens.

## Exports

CSV cells beginning with `=`, `+`, `-`, `@`, tab, or carriage return are
prefixed with `'` so spreadsheets don't execute them as formulas.

## Access

`APP_PASSWORD` gates every API route with an HttpOnly, SameSite=Lax, Secure
cookie holding an HMAC of the password. It is a private-phase measure;
accounts replace it.

## Response headers

All responses send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
a strict referrer policy, and a permissions policy disabling camera,
microphone, and location.
