# Word forms in extension 0.2.1

The popup shows the actual meaning of the base word for explicit plural, tense,
participle and comparative references. The clicked form remains the saved word.
Noun and verb meanings stay separate. A short grammar note appears above the
definition; examples borrowed from the base word are labeled. Pronunciation is
never copied from the base word.

## Activate locally

1. Run the updated web app with `npm run dev`. The existing migrations 001–008
   must already be applied for saving and syncing; this change adds no migration.
2. At `chrome://extensions`, reload Phrasebook from the existing
   `artifacts/extension` folder. Keep the folder and extension ID unchanged.
3. Refresh YouTube and other open website/Phrasebook tabs.
4. Keep the dictionary manifest URL as
   `http://localhost:3000/dictionaries/manifest.json`. The local manifest now
   points to `2026.10.21.1-forms`. In the toolbar choose **Download / update all
   dictionaries**, or select one mode and **Download this dictionary**. Keep
   the popup open until installation finishes. Existing packs remain active
   until their replacement is fully verified.
5. Try `excuses`, `children`, `went`, `running`, and `restructured` in
   English–English and English–Vietnamese. Choose noun/verb meanings deliberately;
   there is no automatic sentence-based sense selection. Vietnamese–English
   keeps its English translation/headword and can add a grammar note from an
   installed English pack when the relationship is unambiguous.
6. Save one sense and check its actual definition and grammar note on the web
   flashcard. Existing saved meanings are not rewritten automatically.

Legacy packs work with recognized explicit English and Vietnamese grammar
notes, so common cases improve immediately after reloading the extension.
The rebuilt packs also retain upstream `form_of` links and grammar tags for
entries whose wording is not recognized. All three packs total 131,033,528
compressed bytes; the English–English pack accounts for 119,916,722 bytes.

Missing base entries show an explanation and the manual **Fill with AI** action.
AI is never called by local form resolution. The dictionary still uses its
original definitions, which may contain advanced language; manual AI enrichment
is instructed to supply an actual meaning in simple words.

## Build and verify

```powershell
python scripts/build_dictionaries.py --english artifacts/dictionary-sources/english-full.jsonl.gz --vietnamese artifacts/dictionary-sources/vi-extract.jsonl.gz --vietnamese-english artifacts/dictionary-sources/vietnamese-english-full.jsonl.gz --out artifacts/dictionaries-forms --data-version 2026.10.21.1-forms --progress
node tests/full-dictionary-forms.test.mjs
python scripts/publish_local_dictionaries.py --source artifacts/dictionaries-forms --public public/dictionaries
npm run package:extension
```

The full-data check needs the generated packs and is optional in CI. The normal
extension tests use small offline fixtures and cover language/POS matching,
legacy grammar notes, irregular forms, chains/cycles, missing bases, saved
private fields and stable references. Resolution uses at most 32 indexed base
reads, three link levels, 256 candidate visits and 200 returned senses.

The local browser harness tests real popup code with simulated Chrome/video
APIs, not a claim of installed-extension or live YouTube verification. Generated
packs and the release ZIP remain outside Git. No R2 upload or Store submission
is performed by these commands.
