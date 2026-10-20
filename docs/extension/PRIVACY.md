# Phrasebook extension privacy notice

Last updated: 20 October 2026. This notice describes the current extension source; the operator must publish this notice at their production domain and provide a contact address before Store submission.

Phrasebook looks up selected words using dictionaries downloaded to your Chrome profile. Hovering caption words and opening dictionary details do not send an AI request. Audio pronunciation is outside this release.

Google sign-in supplies identity information to Google and the configured Supabase project. The extension stores its Supabase session in extension storage. Your session is not exposed through the website dictionary bridge. The operator controls which accounts are allowed to use the backend.

While signed in, opening a lookup can send the selected term and dictionary mode to the configured Phrasebook server to check saved status. Saving sends the selected term/meaning, source sentence, source URL/title and, for YouTube, video time. These records and flashcards are stored under your Supabase account. Local unsynced records stay in an account-scoped IndexedDB queue.

AI receives the selected term, requested missing fields, existing dictionary information and limited source context only after you click Fill with AI or run AI enrichment from the library. The backend calls its configured OpenAI model with storage disabled. Completed responses are cached per user and request context; request history is visible in the app and extension manager. The extension does not read a provider account balance.

Downloaded dictionaries are public data from Wiktionary contributors via Kaikki/Wiktextract, with source/version/license attribution distributed alongside each pack. A dictionary host receives ordinary download requests. No executable extension code is downloaded from that host.

The configured Phrasebook website can request public dictionary lookups through an origin-checked extension bridge. This bridge cannot read account tokens, personal meaning cache or sync queue. Other websites cannot use this bridge.

The extension does not collect your complete browsing history, entire video transcript or continuous audio. Access to HTTPS pages enables text selection lookup; access to YouTube enables interaction with visible CC. The storage, identity and alarms permissions support dictionaries/queue, sign-in and periodic sync. The server retains minimal deleted-word meaning/reference markers to stop an older offline queue from recreating a deleted entry, and retains operation/backup checkpoints for safe retries. Deleting a vocabulary item does not clear its prior AI request cache or these retry records; account deletion cascades account-scoped records.

Use Downloads and sync to inspect/retry/remove local queue entries or remove downloaded dictionaries. Removing a local entry does not delete an already synced cloud record. Delete cloud vocabulary in the web library. Signing out locks account-scoped personal data; reinstalling the extension or deleting the Chrome profile removes local dictionaries and unsynced records. Export a backup before removing the extension. Account deletion and cloud retention require the production operator's published contact process; no automatic retention schedule is currently configured.
