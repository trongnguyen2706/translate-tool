# Phrasebook Chrome extension

This is a Manifest V3 extension. Its executable files are packaged locally; dictionary packs are data and are downloaded separately.

## Local checks

From the repository root run:

```powershell
npm run check:extension
npm run test:dictionaries
```

The build output is `artifacts/extension/`. The checked-in source remains in `extension/`.

## Connect a Phrasebook account

In the extension settings, enter the web app origin, Supabase project URL, Supabase publishable/anon key, and the Google OAuth client ID registered for this Chrome extension. The publishable key is public client configuration; never enter a Supabase secret or service-role key. The user signs in through Google, then the extension verifies the resulting Supabase session against the existing allowed Google account policy.

Register the extension's Chrome Identity redirect URL (`chrome.identity.getRedirectURL("supabase-auth")`, shaped like `https://<extension-id>.chromiumapp.org/supabase-auth`) with the Google OAuth client. The Supabase Google provider must accept the web app client ID and extension client ID; Supabase documents comma-separated client IDs with the web client first. Set `CHROME_EXTENSION_IDS` on the server to the exact published extension ID(s) before production use. The extension ID must stay stable between releases.

Run migrations `004_extension_capture.sql` and `005_usage_reservations.sql` after migrations 001–003 before using extension APIs or any AI endpoint. They are additive and preserve existing vocabulary IDs and flashcard rows. Test them on a disposable database snapshot before applying them to a live project.

## Build and host dictionary packs

Obtain the Kaikki English Wiktionary JSONL and Vietnamese Wiktionary JSONL from their published source. Keep the raw files outside Git. Build compact, chunked packages with:

```powershell
python scripts/build_dictionaries.py --english <path-to-english-jsonl> --vietnamese <path-to-vietnamese-jsonl> --out artifacts/dictionaries
```

Review upstream license and attribution requirements before distributing a pack. The manifest records source, license, schema/data version, chunk sizes and SHA-256. Upload the generated `artifacts/dictionaries/` files to a public R2 bucket behind a custom domain, then enter the HTTPS `manifest.json` URL in extension settings. Do not put user data or credentials in that bucket. No generated dictionary pack is committed to this repository.

## Current limits

The repo contains the build pipeline and local extension source, but no full dictionary data. YouTube CC rendering, sign-in, database RPCs, and offline restart behavior still require the staged browser/database checks recorded in `IMPLEMENTATION_LOG.md` before a release claim.
