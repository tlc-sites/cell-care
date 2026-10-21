import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), routes=require('../notification-route');
const source=await readFile(new URL('../notifications-ui.js',import.meta.url),'utf8');
const id='10000000-0000-4000-8000-000000000001';
function setup({hash='',ctx={}}={}) {
 const navigated=[], listeners={}, history=[], dom={ hidden:true,textContent:'' };
 const sandbox={URL,URLSearchParams,location:new URL('https://app.example/'+hash),
   S:{ctx,me:{id:'one'}}, E:null, DEMO:{role:null}, NOTE:{},
   CellCareRoutes:routes,tr:(ko)=>ko,esc:s=>String(s??'').replaceAll('<','&lt;'),dateTime:s=>s,nl2br:s=>s,
   history:{state:{},replaceState:(s,t,url)=>history.push(url)},
   document:{addEventListener:(k,fn)=>listeners[k]=fn,getElementById:id=>id==='notification-count'?dom:null,visibilityState:'visible'},
   window:{addEventListener(){},setInterval(){}},navigator:{},rpc:async name=>name==='cellcare_notification_can_open'?true:[],
   availableTabs:()=>[{id:'leader'}],TAB_HOME:{leader:{name:'leaderHome'}},
   go:async view=>navigated.push(view),toast(){} };
 vm.createContext(sandbox); vm.runInContext(source,sandbox);
 return {sandbox,history,dom,navigated,listeners,run:code=>vm.runInContext(code,sandbox)};
}
test('로그인 전 알림 목적지를 보존하고 로그인 후 해당 보고를 연다',async()=>{
 const s=setup({hash:'#report='+id,ctx:null});
 assert.ok(s.history[0].includes('notification='));
 assert.equal(await s.run('openNotificationRoute(INBOX.pending)'),false);
 s.sandbox.S.ctx={};
 assert.equal(await s.run('openNotificationRoute(INBOX.pending)'),true);
 assert.equal(s.navigated[0].id,id);
 assert.equal(s.navigated[0].name,'detail');
 assert.equal(s.run('INBOX.pending'),null);
});
test('저장 실패 시 알림을 눌러도 작성 내용을 버리고 이동하지 않는다',async()=>{
 const s=setup();s.sandbox.E={dirty:true};s.sandbox.save=async()=>false;
 assert.equal(await s.run(`openNotificationRoute(CellCareRoutes.parse('#report=${id}'))`),false);
 assert.equal(s.navigated.length,0);
});
test('계정이 바뀐 동안 완료된 이전 계정의 알림 조회를 버린다',async()=>{
 const s=setup();let finish;
 s.sandbox.rpc=()=>new Promise(resolve=>finish=resolve);
 const pending=s.run('refreshInboxBadge(true)');
 s.sandbox.S.me={id:'two'};finish([{id:'private',body:'old user'}]);await pending;
 assert.equal(s.run('INBOX.rows.length'),0);
});
test('답글 내용은 HTML로 실행되지 않게 표시한다',()=>{
 const s=setup();s.run(`INBOX.replyRows['report:${id}']=[{id:'reply',author_name:'Demo',content:'<script>alert(1)</script>',created_at:'date',mine:false}]`);
 s.sandbox.nl2br=s.sandbox.esc;
 const html=s.run(`replyBlock('report','${id}')`);
 assert.ok(html.includes('&lt;script>'));assert.ok(!html.includes('<script>'));
});
