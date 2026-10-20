import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createBackupArchive, readBackupArchive } from "../src/lib/backup-archive.mjs";

test("2,101-word ZIP restores twice without duplicate vocabulary, lost progress or broken context references", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select '{"email":"backup@test.local","app_metadata":{"provider":"google"}}'::jsonb$$;
      grant usage on schema auth to authenticated;grant execute on all functions in schema auth to authenticated;`);
    for (const file of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec((await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).replace("create extension if not exists pgcrypto;", ""));
    }
    await db.exec("insert into auth.users values('11111111-1111-4111-8111-111111111111');insert into private.allowed_users(email) values('backup@test.local');set role authenticated;");
    const vocabulary = Array.from({ length: 2101 }, (_, index) => ({ id: crypto.randomUUID(), term: `roundtrip ${index}`, kind:"phrase",source_language:"en",meaning_en:`definition ${index}`,meaning_vi:"", example:"A saved example.",collocations:[],tags:[],ielts_skills:[],topics:[],learning_reason:"",source_text:"",note:"",details:{ipa:"/test/"},created_at:"2026-10-01T00:00:00Z" }));
    const flashcards = vocabulary.map((word) => ({vocabulary_item_id:word.id,status:"mastered"}));
    const occurrences = [{vocabulary_item_id:vocabulary[2100].id, operation_id:crypto.randomUUID(),selected_text:vocabulary[2100].term,context_text:"saved video context",source_url:"https://www.youtube.com/watch?v=test",source_title:"Test source",source_kind:"youtube",direction:"en-en",video_time:42}];
    const archive = await createBackupArchive({vocabulary,flashcards,occurrences});
    const parts = await readBackupArchive(archive);
    for (let run=0;run<2;run++) for (const part of parts) {
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(part.body)))].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
      const result = (await db.query("select public.restore_backup_part($1,$2,$3) result",[part.id,hash,JSON.parse(part.body)])).rows[0].result;
      assert.equal(result.replayed,run===1);
    }
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items")).rows[0].n,2101);
    assert.equal((await db.query("select count(*)::int n from public.flashcards where status='mastered'")).rows[0].n,2101);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_occurrences o join public.vocabulary_items v on o.vocabulary_item_id=v.id and o.user_id=v.user_id where v.term='roundtrip 2100' and o.video_time=42")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from public.vocabulary_items where created_at='2026-10-01T00:00:00Z' and details->>'ipa'='/test/'")).rows[0].n,2101);
  } finally { await db.close(); }
});
