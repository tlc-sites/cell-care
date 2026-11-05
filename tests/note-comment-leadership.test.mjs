import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261107020000_note_comment_leadership.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 담임 목사님, 2 교역자(동정 볼 수 있음), 3 교역자(못 봄), 4 셀리더(교역자 아님, 볼 수 있다고 해도) · 41 동정, 42 지운 동정

test('성도 동정 코멘트: 담임 목사님·사모님과, 그 동정을 볼 수 있는 교역자가 남긴다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create table public.user_roles(user_id uuid,role text);
      create table public.pastoral_notes(id uuid primary key,active boolean);
      create table public.pastoral_note_comments(id uuid primary key default gen_random_uuid(),note_id uuid,author_id uuid,content text);
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.has_role(r text) returns boolean language sql as $$select exists(select 1 from public.user_roles where user_id=private.current_profile_id() and role=r)$$;
      create function private.is_senior() returns boolean language sql as $$select private.has_role('senior_pastor') or private.has_role('samonim')$$;
      create function private.can_read_pastoral_note(p uuid) returns boolean language sql as $$select private.current_profile_id() in ('${u(1)}'::uuid,'${u(2)}'::uuid,'${u(4)}'::uuid)$$;
      insert into public.user_roles values('${u(1)}','senior_pastor'),('${u(2)}','leadership'),('${u(3)}','leadership');
      insert into public.pastoral_notes values('${u(41)}',true),('${u(42)}',false);
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전
    const actor = n => db.exec(`set test.actor='${u(n)}'`);
    const add = (note, text) => db.query('select public.note_comment_add($1,$2) as id', [note, text]);

    await actor(1); assert.ok((await add(u(41), '함께 기도합니다')).rows[0].id);
    await actor(2); assert.ok((await add(u(41), '  심방 다녀왔습니다  ')).rows[0].id);
    assert.equal((await db.query(`select content from public.pastoral_note_comments where author_id='${u(2)}'`)).rows[0].content, '심방 다녀왔습니다');
    await assert.rejects(add(u(41), '   '), /코멘트를 적어 주세요/);
    await assert.rejects(add(u(42), '지운 동정'), /동정을 찾지 못했습니다/);
    await actor(3); await assert.rejects(add(u(41), '못 보는 동정'), /동정을 찾지 못했습니다/);
    await actor(4); await assert.rejects(add(u(41), '셀리더'), /교역자만/);
    assert.equal((await db.query('select count(*)::int n from public.pastoral_note_comments')).rows[0].n, 2);
    assert.equal((await db.query(`select has_function_privilege('anon','public.note_comment_add(uuid,text)','execute') g`)).rows[0].g, false);
  } finally { await db.close(); }
});
