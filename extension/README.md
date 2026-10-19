# Phrasebook Chrome extension

This is a Manifest V3 extension. Its executable files are packaged locally; dictionary packs are data and are downloaded separately.

## Local checks

From the repository root run:

```powershell
npm run check:extension
npm run test:dictionaries
npm run test:dictionary-language
```

The build output is `artifacts/extension/`. The checked-in source remains in `extension/`.

For browser interaction regression checks, run `npm run test:extension-ui` and open `http://127.0.0.1:3001`. This local-only harness serves the real content script and CSS; it substitutes only the YouTube hostname check and mocks Chrome messaging/dictionary results and video playback. **Run interaction checks** covers popup stacking/hit testing, caption selection and hover, stale selection, pause ownership, reused caption DOM, and simulated fullscreen entry/exit. It does not verify auth, real media playback, or real fullscreen rendering. Use **Enter fullscreen** and repeat checks manually when browser automation cannot grant fullscreen. You can also double-click page/caption words or drag across captions to verify the native selection and **Tra** button.

After building an extension update, reload Phrasebook at `chrome://extensions` and refresh existing website/YouTube tabs. Hovering a CC word highlights it; a single click opens its basic definition. Selecting text or double-clicking offers **Tra**; clicking unrelated page content does not reuse an old selection. Normal/theater view keeps the popup outside the player stacking context; fullscreen moves it into the fullscreen element and restores it on exit.

CC tokens keep internal hyphens (`eco-friendly`, `mother-in-law`), typographic/non-breaking hyphens, and apostrophes together. En/em dashes still separate words. Double-clicking a caption compound selects the entire token, including when Chrome's native selection includes trailing whitespace; drag selections keep their chosen range. Typographic hyphens use the standard `-` for lookup and saving, while `queryTerm` and caption context retain the original text. Hover uses a translucent blue background and a thin rounded underline without changing caption color, font size, or layout; the open word stays marked until its popup closes. Recognition does not guarantee a definition in every language pack: the current full English-English pack contains `eco-friendly`, while English-Vietnamese may still require explicit AI enrichment. This UI/token update does not change dictionary data.

## Connect a Phrasebook account

In the extension settings, enter the web app origin, Supabase project URL, Supabase publishable/anon key, and a Google OAuth **Web application** client ID. This implementation uses `chrome.identity.launchWebAuthFlow`, so the Chrome Extension OAuth client type is not the client used by this flow. The publishable key is public client configuration; never enter a Supabase secret or service-role key. The user signs in through Google, then the extension verifies the resulting Supabase session against the existing allowed Google account policy.

Add the extension's Chrome Identity redirect URL (`chrome.identity.getRedirectURL("supabase-auth")`, shaped like `https://<extension-id>.chromiumapp.org/supabase-auth`) to the Web application client's Authorized redirect URIs, keeping the Supabase callback already registered there. The Supabase Google provider must accept this web client ID; multiple client IDs may remain comma-separated with the web client first. Set `CHROME_EXTENSION_IDS` on the server to the exact published extension ID(s) before production use. The extension ID must stay stable between releases.

Run migrations `004_extension_capture.sql` and `005_usage_reservations.sql` after migrations 001–003 before using extension APIs or any AI endpoint. They are additive and preserve existing vocabulary IDs and flashcard rows. Test them on a disposable database snapshot before applying them to a live project.

## Build and host dictionary packs

Obtain the Kaikki English Wiktionary JSONL and Vietnamese Wiktionary JSONL from their published source. Keep the raw files outside Git. Build compact, chunked packages with:

```powershell
python scripts/build_dictionaries.py --english <path-to-english-jsonl> --vietnamese <path-to-vietnamese-jsonl> --out artifacts/dictionaries
```

Review upstream license and attribution requirements before distributing a pack. The manifest records source, license, schema/data version, chunk sizes and SHA-256. Upload the generated `artifacts/dictionaries/` files to a public R2 bucket behind a custom domain, then enter the HTTPS `manifest.json` URL in extension settings. Do not put user data or credentials in that bucket. No generated dictionary pack is committed to this repository.

## Current limits

The checked-in repository contains the build pipeline and extension source; generated dictionary data is installed separately. YouTube CC rendering, sign-in, database RPCs, and offline restart behavior still require the staged browser/database checks recorded in `IMPLEMENTATION_LOG.md` before a release claim.

## Install dictionaries in local staging

The dictionary files are data, separate from the extension. Do not enter a raw Kaikki JSONL URL as the manifest. For a smaller basic English-English pack use the Simple English edition; English-Vietnamese and Vietnamese-English use the Vietnamese edition and its explicit translation pairs. The builder accepts `.jsonl` and `.jsonl.gz` directly.

Download the compressed **Simple English** and **Vietnamese** datasets linked on [Kaikki's raw download page](https://kaikki.org/dictionary/rawdata.html) into `artifacts/dictionary-sources/`, then run:

```powershell
python scripts/build_dictionaries.py --english artifacts/dictionary-sources/simple-extract.jsonl.gz --vietnamese artifacts/dictionary-sources/vi-extract.jsonl.gz --english-source "Kaikki Simple English Wiktionary (basic English definitions)" --out public/dictionaries
npm run dev
```

In extension settings set **Dictionary manifest URL** to `http://localhost:3000/dictionaries/manifest.json` and save. Open the extension toolbar popup, select a mode, click **Tải từ điển cho chế độ này**, and wait for the installed-entry count. Repeat for the other modes. Keep the popup open until installation finishes. Once installed, lookup uses IndexedDB and does not need the local server. AI and cloud sync still need the web server.

Generated source and dictionary data are ignored by Git. The local URL works only on this machine; for other users publish the generated manifest, chunks, and source attribution together on an HTTPS host such as the planned R2 domain.

## Expanded dictionaries and installing all modes

For expanded coverage, use the full [English extract](https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz) and [Vietnamese entries with English definitions](https://kaikki.org/dictionary/Vietnamese/kaikki.org-dictionary-Vietnamese.jsonl.gz), plus the Vietnamese-edition extract above. Keep all three under `artifacts/dictionary-sources/` and build a new data version:

```powershell
python scripts/build_dictionaries.py --english artifacts/dictionary-sources/english-full.jsonl.gz --vietnamese artifacts/dictionary-sources/vi-extract.jsonl.gz --vietnamese-english artifacts/dictionary-sources/vietnamese-english-full.jsonl.gz --data-version 2026.10.19.3-full --progress --out artifacts/dictionaries-full
python scripts/publish_local_dictionaries.py --source artifacts/dictionaries-full
```

The publisher validates every chunk, preserves immutable version directories, writes attribution, and switches the root manifest after all files pass validation. Use a new version whenever package contents change. English-Vietnamese includes native definitions, explicit Vietnamese translations from the English edition for missing headwords, and verified inflected-form links. Vietnamese-English adds English definitions of Vietnamese words; if a canonical English headword is not explicitly available, lookup still works and the user can request AI before saving an English flashcard.

In the extension toolbar popup click **Tải / cập nhật cả 3 bộ từ điển**. The selected lookup mode stays the same. Progress is reported by verified chunks and entry counts. Keep the popup open; after a network/browser interruption, click the same button again to resume verified chunks and skip ready packages. A new version only replaces the active dictionary for that mode after installation completes. Full word entries may contain up to 1,000 senses within the existing 2 MiB chunk bound; no additional extension permissions are requested.

AI enrichment snapshots the lookup mode and declares the definition language explicitly: Vietnamese definitions for English-Vietnamese, English definitions for the other modes. Obvious wrong-language output is rejected before it reaches the popup or vocabulary storage. Language checking is conservative rather than a complete language detector. Changing the mode closes the previous draft so it cannot be relabeled under another mode.
