import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { resolveWordForms } from "../extension/src/dictionary-core.mjs";

test("migrations preserve identity, transactions, progress, owner isolation and AI request reuse", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
      grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`);
    const files = (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
    const user = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
    const legacyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.query("insert into auth.users values($1),($2)", [user, other]);
    for (const file of files) {
      if (file.startsWith("007")) {
        await db.query("insert into public.vocabulary_items(id,user_id,term,normalized_term,kind,source_language,meaning_vi,normalized_meaning) values($1,$2,'legacy','legacy','word','en','từ cũ','từ cũ')", [legacyId,user]);
        await db.query("insert into public.flashcards(user_id,vocabulary_item_id,status) values($1,$2,'mastered')", [user,legacyId]);
        await db.query("insert into public.vocabulary_items(user_id,term,normalized_term,kind,source_language,meaning_en,meaning_vi,normalized_meaning) values($1,'ambiguous','ambiguous','word','en','first sense','nghĩa giống','first sense'),($1,'ambiguous','ambiguous','word','en','second sense','nghĩa giống','second sense')", [user]);
      }
      const sql = (await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", "");
      try { await db.exec(sql); } catch (error) { throw new Error(`${file}: ${error.message}`); }
    }
    await db.exec("insert into private.allowed_users(email) values('a@test.local'),('b@test.local')");
    const login = async (id, email) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ email, app_metadata: { provider: "google" } })]);
      await db.exec("set role authenticated");
    };
    const rpc = async (name, args, casts) => (await db.query(`select public.${name}(${args.map((_, index) => `$${index + 1}${casts?.[index] ?? ""}`).join(",")}) as result`, args)).rows[0].result;
    await login(user, "a@test.local");
    const legacy = await rpc("save_vocabulary_item", [{term:"legacy",source_language:"en",meaning_vi:"từ cũ"}]);
    assert.equal(legacy.item.id, legacyId, "cutover keeps the legacy ID and backfills aliases");
    assert.equal((await db.query("select status from public.flashcards where vocabulary_item_id=$1", [legacyId])).rows[0].status, "mastered");
    await assert.rejects(rpc("save_vocabulary_item", [{ term:"ambiguous",source_language:"en",meaning_vi:"nghĩa giống" }]), /Ambiguous meaning/);
    const chosen = (await db.query("select id from public.vocabulary_items where term='ambiguous' order by id limit 1")).rows[0].id;
    assert.equal((await rpc("save_vocabulary_item", [{ term:"ambiguous",source_language:"en",meaning_vi:"nghĩa giống",confirmed_item_id:chosen }])).item.id,chosen);
    const original = await rpc("save_vocabulary_item", [{ term: "bank", source_language: "en", meaning_vi: "ngân hàng" }]);
    const id = original.item.id;
    const filled = await rpc("save_vocabulary_item", [{ meaning_en: "a financial institution" }, id, true, original.item.revision]);
    assert.equal(filled.item.id, id);
    const duplicate = await rpc("save_vocabulary_item", [{ term: "bank", source_language: "en", meaning_vi: "ngân hàng" }]);
    assert.equal(duplicate.item.id, id);
    assert.equal(duplicate.already_existed, true);
    const different = await rpc("save_vocabulary_item", [{ term: "bank", source_language: "en", meaning_en: "the side of a river" }]);
    assert.notEqual(different.item.id, id);
    await assert.rejects(rpc("save_vocabulary_item", [{ meaning_en: "stale edit" }, id, true, 1]), /Item changed/);
    const operation = "33333333-3333-4333-8333-333333333333";
    const capture = { term: "bank", kind: "word", source_language: "en", meaning_vi: "ngân hàng" };
    const occurrence = { selected_text: "bank", context_text: "The bank is open.", source_url: "https://example.com/", source_kind: "web", direction: "en-vi", video_time: null };
    const result = await rpc("capture_extension_word", [operation, "a".repeat(64), capture, occurrence]);
    assert.equal(result.item_id, id);
    await db.query("update public.flashcards set status='mastered' where vocabulary_item_id=$1", [id]);
    assert.equal((await rpc("capture_extension_word", [operation, "a".repeat(64), capture, occurrence])).replayed, true);
    await assert.rejects(rpc("capture_extension_word", [operation, "b".repeat(64), capture, occurrence]), /different payload/);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_occurrences")).rows[0].n, 1);
    await Promise.all([rpc("capture_extension_word", [crypto.randomUUID(), "a".repeat(64), capture, occurrence]),rpc("capture_extension_word", [crypto.randomUUID(), "a".repeat(64), capture, occurrence])]);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_occurrences")).rows[0].n, 1, "repeated saves of the same context do not duplicate occurrences");
    assert.equal((await db.query("select status from public.flashcards where vocabulary_item_id=$1", [id])).rows[0].status, "mastered");
    assert.equal(await rpc("undo_vocabulary_save", [id, duplicate.item.revision]), false);
    const baseSense = { id:"excuse-noun", partOfSpeech:"noun", definitions:["a reason given to explain a mistake"] };
    const formSense = (await resolveWordForms("excuses", [{ id:"excuses-noun", partOfSpeech:"noun", definitions:["plural of excuse"] }], () => [baseSense], "en-en", "forms-v1"))[0];
    const baseSaved = await rpc("save_vocabulary_item", [{term:"excuse",source_language:"en",meaning_en:baseSense.definitions[0],identity_provider:"kaikki-en",identity_reference:baseSense.id,identity_version:"forms-v1"}]);
    const formPayload = {term:"excuses",kind:"word",source_language:"en",meaning_en:formSense.definitions[0],identity_provider:"kaikki-en",identity_reference:formSense.id,identity_version:"forms-v1",
      details:{baseForm:formSense.baseForm,formNote:formSense.formNote,baseSenseId:formSense.baseSenseId}};
    const formOccurrence = {...occurrence,selected_text:"excuses",context_text:"She makes excuses.",direction:"en-en"};
    const formSaved = await rpc("capture_extension_word",[crypto.randomUUID(),"7".repeat(64),formPayload,formOccurrence]);
    assert.notEqual(formSaved.item_id,baseSaved.item.id,"base and inflected terms keep separate vocabulary IDs");
    const storedForm = (await db.query("select term,meaning_en,details from public.vocabulary_items where id=$1",[formSaved.item_id])).rows[0];
    assert.equal(storedForm.term,"excuses"); assert.equal(storedForm.meaning_en,baseSense.definitions[0]);
    assert.equal(storedForm.details.formNote,"Plural of excuse");
    await db.query("update public.flashcards set status='learned' where vocabulary_item_id=$1",[formSaved.item_id]);
    assert.equal((await rpc("capture_extension_word",[crypto.randomUUID(),"7".repeat(64),formPayload,formOccurrence])).item_id,formSaved.item_id);
    assert.equal((await db.query("select status from public.flashcards where vocabulary_item_id=$1",[formSaved.item_id])).rows[0].status,"learned");
    const oldId = "44444444-4444-4444-8444-444444444444", partId = "55555555-5555-4555-8555-555555555555";
    const backup = { version: 4, vocabulary: [{ id: oldId, term: "bank", source_language: "en", meaning_vi: "ngân hàng" }],
      flashcards: [{ vocabulary_item_id: oldId, status: "not_yet" }], translations: [] };
    assert.equal((await rpc("restore_backup_part", [partId, "d".repeat(64), backup])).replayed, false);
    assert.equal((await rpc("restore_backup_part", [partId, "d".repeat(64), backup])).replayed, true);
    assert.equal((await db.query("select status from public.flashcards where vocabulary_item_id=$1", [id])).rows[0].status, "mastered");
    const broken = { version: 4, vocabulary: [{ id: crypto.randomUUID(), term: "rollback-word", source_language: "en", meaning_en: "rollback test" }], flashcards: [{ vocabulary_item_id: crypto.randomUUID(), status: "learned" }] };
    await assert.rejects(rpc("restore_backup_part", [crypto.randomUUID(), "e".repeat(64), broken]), /Unknown flashcard/);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items where term='rollback-word'")).rows[0].n, 0);
    await assert.rejects(rpc("restore_backup_part", [partId, "f".repeat(64), backup]), /conflict/);
    const daily = { ...backup, daily_sets: [{ study_date:"2026-10-01", filters:{createdMode:"all",levelMode:"all",ieltsMode:"all",skill:"all",topic:"all",tag:"",kind:"all"}, requested_count:1, items:[{vocabulary_item_id:oldId,studied:true}] }] };
    await rpc("restore_backup_part", [crypto.randomUUID(),"4".repeat(64),daily]);
    assert.equal((await db.query("select count(*)::int n from public.daily_word_set_items where vocabulary_item_id=$1 and studied_at is not null",[id])).rows[0].n,1);
    const removedWord = await rpc("save_vocabulary_item",[{term:"deleted-queue-test",source_language:"en",meaning_en:"a deletion test"}]);
    assert.equal((await rpc("delete_vocabulary_items",[[removedWord.item.id]])).length,1);
    const deletedCapture = {term:"deleted-queue-test",kind:"word",source_language:"en",meaning_en:"a deletion test",capture_created_at:"2020-01-01T00:00:00Z"};
    await assert.rejects(rpc("capture_extension_word",[crypto.randomUUID(),"8".repeat(64),deletedCapture,occurrence]), /deleted after/);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items where term='deleted-queue-test'")).rows[0].n,0);
    assert.ok((await rpc("capture_extension_word",[crypto.randomUUID(),"8".repeat(64),{...deletedCapture,capture_created_at:"2030-01-01T00:00:00Z"},occurrence])).item_id,"a deliberate newer save can restore the word");
    const claim = await rpc("claim_enrichment", ["c".repeat(64), "en-en", ["definitions"]]);
    assert.equal(claim.claimed, true);
    assert.equal((await rpc("claim_enrichment", ["c".repeat(64), "en-en", ["definitions"]])).claimed, false);
    await rpc("finish_enrichment", [claim.id, "complete", { fields: { definitions: ["cached definition"] } }]);
    assert.equal((await rpc("claim_enrichment", ["c".repeat(64), "en-en", ["definitions"]])).result.fields.definitions[0], "cached definition");
    const pending = await rpc("claim_enrichment", ["9".repeat(64), "en-en", ["ipa"]]);
    await db.exec("reset role"); await db.query("update public.enrichment_requests set updated_at=now()-interval '3 minutes' where id=$1", [pending.id]); await db.exec("set role authenticated");
    assert.equal((await rpc("claim_enrichment", ["9".repeat(64), "en-en", ["ipa"]])).state, "uncertain");
    assert.equal(await rpc("reset_uncertain_enrichment", [pending.id]), true);
    assert.equal((await rpc("claim_enrichment", ["9".repeat(64), "en-en", ["ipa"]])).claimed, true);
    await login(other, "b@test.local");
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_occurrences")).rows[0].n, 0);
    assert.equal(await rpc("finish_enrichment", [claim.id, "complete", { fields: {} }]), false);
    const isolated = await rpc("save_vocabulary_item", [{ term: "bank", source_language: "en", meaning_vi: "ngân hàng" }]);
    assert.notEqual(isolated.item.id, id);
    await assert.rejects(rpc("save_vocabulary_item", [{ note: "unauthorized" }, id, true, 1]), /Item not found/);
    await login(other, "denied@test.local");
    await assert.rejects(rpc("save_vocabulary_item", [{ term: "test" }]), /Not allowed/);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [other]);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items where user_id=$1", [other])).rows[0].n, 0, "account cascade does not recreate deletion markers under a removed parent");
  } finally { await db.close(); }
});
