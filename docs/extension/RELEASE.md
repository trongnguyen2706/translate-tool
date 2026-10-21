# Staging and release runbook

Audio pronunciation is excluded. IPA remains text metadata. AI balance/budget UI remains excluded at the user's request.

For extension 0.2.2, see [word-form and learner-meaning activation](WORD_FORMS.md). Its optional JSON
metadata uses the existing schema; no migration beyond 001–008 is introduced.

## Apply backend changes

1. Take a verified staging database snapshot. Apply migrations 006, 007, 008 in order after 001–005. Do not deploy the new writers against a database missing 007. These migrations add an owner-scoped request cache, stable meaning aliases and atomic backup checkpoints. Migration 007 removes the old content-based unique constraint; existing IDs, flashcards and study sets remain intact.
2. Deploy the matching application and extension together for beta. Old tabs call the current backend; a previously deployed backend that still writes with the old conflict target must not be rolled back after 007. A rollback must retain the new writer RPCs. Preserve migration snapshots and never delete ledger rows to resolve a retry.
   Deletion protection records removals made after 007; it cannot reconstruct removals that happened before the migration. Queue intent times come from the client clock. Personal cached senses retain the original dictionary data version when saved after a pack update/removal.
3. Run `npm run test:database`, `npm run test:backup`, `npm run check:extension`, dictionary tests, lint, typegen/typecheck and the production build. PostgreSQL tests use an isolated PGlite instance with emulated Supabase auth claims, not a claim of staged load or live RLS validation.
4. On staging, use two allowed accounts and one denied account. Verify sign-in/refresh/logout, capture then flashcard, same-word/different-sense, existing progress, interrupted sync/restart, wrong-account isolation, fill-only enrichment and ZIP restore twice. Avoid paid model calls during load tests. The user must reload the unpacked extension and existing tabs after updating.

## Host dictionaries

Build and validate versioned packs using the existing Python scripts. Public dictionary data stays out of Git. Use a custom HTTPS domain connected to an R2 bucket; each beta/stable channel has a root manifest and immutable versioned chunks. Do not set Content-Encoding gzip: the installer verifies and decompresses the raw `.gz` bytes itself.

`powershell -File scripts/publish_dictionaries_r2.ps1 -Bucket YOUR_BUCKET -Channel beta` verifies local checksums and produces a dry run. After configuring the official Wrangler CLI for your bucket, rerun with `-Publish`. Upload failures leave the previous root manifest active. Use a new data version for changed bytes; do not replace existing versioned objects with different content.

The extension's manifest URL is `https://YOUR_DICTIONARY_DOMAIN/beta/manifest.json`. Verify every manifest/chunk on that hostname, including attribution. Configure short cache duration for manifest and long immutable caching for chunks. If the domain caches manifest longer, purge just that manifest when switching versions. [Wrangler R2 commands](https://developers.cloudflare.com/workers/wrangler/commands/r2/) · [R2 caching and custom domains](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).

## Production configuration

Use the operator's Vercel project/domain and Supabase production project. Set the existing public Supabase variables, server AI key/model, per-user quotas and `CHROME_EXTENSION_IDS` to the stable Store ID. Configure Google web OAuth redirects for both Supabase callback and Chrome Identity callback; never put client secrets in the extension. Public enrollment remains disabled through the server allowlist. Set `EXTENSION_CAPTURE_ENABLED=false` to pause cloud saving while keeping local queues; set `AI_ENRICHMENT_ENABLED=false` to pause new enrichment model calls while allowing cache hits and dictionary enrichment. Interactive CC can be disabled/restored from extension Settings.

There are no configured Cloudflare/Vercel credentials or linked Vercel project in the current workspace. Upload/deployment and Store submission cannot be completed from source alone. Prepare the account, bucket/custom domain and Store publisher access first. Do not publish a package pointing users to localhost.

## Store package

Run `npm run package:extension`. The deterministic ZIP includes only manifest, packaged scripts/styles/pages and icons. Dictionaries, environment files, session data and test fixtures are excluded. Install from the fixed Store listing ID, configure the production endpoints and repeat onboarding on a clean Chrome profile. A changing unpacked folder ID is not a production upgrade test.

Use the supplied privacy notice as the operator-reviewed basis for the public privacy URL. Listing short description: “Look up words in downloaded dictionaries and save them with context to Phrasebook.” Describe visible YouTube CC lookup, manual AI filling, offline dictionaries, sync and web flashcards accurately. Explain every requested permission. Provide real screenshots from the installed release with a test account; mock fixture screenshots are verification evidence, not Store marketing screenshots. Google review and publisher terms are external steps.

## Verification still required on the installed extension

Actual YouTube fullscreen, rolling/manual captions, SPA video changes, already-paused videos, long sessions, page zoom/accessibility, offline browser restart and worker suspension. Shorts, PiP and embedded players are not advertised as supported until verified. The browser fixture tests layout and state transitions; it does not replace these checks.

Before expanding beyond beta, record target simultaneous users/RPS, run the read-only staging load test with separate test tokens, review error rates/p95, Supabase limits and CDN download counts. Do not infer capacity from a single development profile. Keep backup/restore rehearsals, account deletion policy and a named operator for incidents. Scheduling/notifications require a separate operator request.
