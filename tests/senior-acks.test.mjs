import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261023010000_senior_acks.sql', import.meta.url), 'utf8');
const u = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// 1 담임 목사님, 2 담임 사모님, 3 교역자, 4 셀리더(보고서 31만 읽음), 5 사용 중지된 담임 목사님 계정
// 31 제출된 보고서, 32 작성 중 보고서, 41 교역자 보고

test('담임 목사님·사모님 확인: 두 분이 각자 남기고, 다른 분은 남길 수 없으며 볼 수 있는 분만 본다', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema private;
      create table public.profiles(id uuid primary key,name text,active boolean);
      create table public.weekly_reports(id uuid primary key,status text);
      create function private.current_profile_id() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function private.has_role(r text) returns boolean language sql as $$
        select (r='senior_pastor' and private.current_profile_id() in ('${u(1)}'::uuid,'${u(5)}'::uuid))
            or (r='samonim' and private.current_profile_id()='${u(2)}'::uuid)
            or (r='leadership' and private.current_profile_id()='${u(3)}'::uuid)$$;
      create function private.is_senior() returns boolean language sql as $$select private.has_role('senior_pastor') or private.has_role('samonim')$$;
      create function private.is_admin() returns boolean language sql as $$select false$$;
      create function private.can_read_report(uuid) returns boolean language sql as $$select private.current_profile_id() in ('${u(1)}'::uuid,'${u(2)}'::uuid,'${u(3)}'::uuid,'${u(4)}'::uuid,'${u(5)}'::uuid)$$;
      create function private.can_see_senior_comment(uuid,text) returns boolean language sql as $$select private.is_senior() or private.current_profile_id()='${u(4)}'::uuid$$;
      insert into public.profiles values('${u(1)}','목사님',true),('${u(2)}','사모님',true),('${u(3)}','교역자',true),('${u(4)}','셀리더',true),('${u(5)}','옛 계정',false);
      insert into public.weekly_reports values('${u(31)}','submitted'),('${u(32)}','draft');
    `);
    await db.exec(migration);
    await db.exec(migration); // 다시 실행해도 안전

    const actor = n => db.exec(`set test.actor='${u(n)}'`);
    const ack = (k, id) => db.query('select report.cellcare_senior_ack($1,$2) as at', [k, id]);
    const acks = async (k, ids) => (await db.query('select target_id,role,name from report.cellcare_senior_acks($1,$2) order by role', [k, ids])).rows;

    await actor(1); await ack('report', u(31)); await ack('pastor_msg', u(31)); await ack('lr', u(41));
    await actor(2); await ack('report', u(31));
    await ack('report', u(31)); // 두 번 눌러도 한 줄
    assert.deepEqual((await acks('report', [u(31)])).map(r => [r.role, r.name]), [['samonim', '사모님'], ['senior_pastor', '목사님']]);

    // 남길 수 없는 경우
    for (const [n, k, id] of [[3, 'report', u(31)], [4, 'pastor_msg', u(31)], [5, 'report', u(31)], [1, 'report', u(32)], [1, 'other', u(31)]]) {
      await actor(n);
      await assert.rejects(ack(k, id), /확인 표시/, `${n} ${k}`);
    }

    // 보기: 셀리더는 자기 보고서와 자기 말씀의 확인을 보고, 교역자 보고 확인은 못 본다
    await actor(4);
    assert.equal((await acks('report', [u(31)])).length, 2);
    assert.equal((await acks('pastor_msg', [u(31)])).length, 1);
    assert.equal((await acks('lr', [u(41)])).length, 0);
    await actor(3);
    assert.equal((await acks('lr', [u(41)])).length, 1);
    assert.equal((await acks('pastor_msg', [u(31)])).length, 0);

    // 직접 테이블 접근과 내부 함수는 막혀 있다
    const priv = async (sql) => (await db.query(sql)).rows[0].ok;
    assert.equal(await priv(`select has_table_privilege('authenticated','report.cellcare_senior_acks','select') ok`), false);
    assert.equal(await priv(`select has_function_privilege('authenticated','report.cellcare_senior_role()','execute') ok`), false);
    assert.equal(await priv(`select has_function_privilege('anon','report.cellcare_senior_ack(text,uuid)','execute') ok`), false);
    assert.equal(await priv(`select has_function_privilege('authenticated','report.cellcare_senior_ack(text,uuid)','execute') ok`), true);
  } finally { await db.close(); }
});
