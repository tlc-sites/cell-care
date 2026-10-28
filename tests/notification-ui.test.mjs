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
test('업데이트 공지는 교역자에게 바로, 셀리더에게는 공개일부터 보이고 읽음은 사용자별로 저장한다',()=>{
 const s=setup({ctx:{}});const store={};
 s.sandbox.localStorage={getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=v;}};
 s.run(`APP_UPDATES.splice(0,APP_UPDATES.length,{id:'v1',publishAt:'2999-01-01T00:00:00+09:00',title:['[공지] 업데이트','x'],body:['<b>본문</b>','x']})`);
 s.sandbox.S.roles=[];
 assert.equal(s.run('visibleUpdates().length'),0);
 s.sandbox.S.roles=['leadership'];
 assert.equal(s.run('visibleUpdates().length'),1);
 s.run('updateInboxBadge()');assert.equal(s.dom.textContent,'1');
 const html=s.run('updateItems()');
 assert.ok(html.includes('&lt;b>본문'));assert.ok(html.includes('새 알림'));
 s.run(`markUpdatesRead(['v1'])`);
 assert.equal(s.run('visibleUpdates()[0].read'),true);
 s.run('updateInboxBadge()');assert.equal(s.dom.hidden,true);
 s.sandbox.S.me={id:'two'};
 assert.equal(s.run('visibleUpdates()[0].read'),false);
 s.sandbox.S.roles=[];s.run(`APP_UPDATES[0].publishAt='2000-01-01T00:00:00+09:00'`);
 assert.equal(s.run('visibleUpdates().length'),1);
 s.sandbox.DEMO.role='leader';
 assert.equal(s.run('visibleUpdates().length'),0);
});
test('셀보고서 제출 알림은 작성자·셀 이름을 보여 주고, 비면 「정보 없음」으로 대신한다',()=>{
 const s=setup();
 s.sandbox.weekLabel=iso=>'주차 '+iso;
 const show=n=>s.run('notificationText('+JSON.stringify(n)+')');
 let t=show({kind:'REPORT_SUBMITTED',author_name:'김사랑',cell_name:'사랑셀',week_start:'2026-10-19',title:'옛 제목',body:' 셀리더님이…'});
 assert.equal(t.body,'김사랑 셀리더님이 셀 보고서를 작성했습니다.');assert.equal(t.meta,'사랑셀 · 주차 2026-10-19');
 t=show({kind:'REPORT_UPDATED',author_name:'김교역 전도사',cell_name:'사랑셀'});
 assert.equal(t.title,'셀보고서가 다시 제출되었습니다');assert.equal(t.body,'김교역 전도사님이 셀 보고서를 다시 제출했습니다.');
 t=show({kind:'REPORT_SUBMITTED',author_name:'작성자 정보 없음',cell_name:' '});
 assert.ok(t.body.startsWith('작성자 정보 없음'));assert.equal(t.meta,'셀 정보 없음');
 assert.ok(!/^\s|님이 셀 보고서/.test(t.body));
 // 다른 알림과 DB 적용 전 알림은 저장된 제목·내용 그대로
 t=show({kind:null,title:'공지',body:'내용'});
 assert.equal(JSON.stringify([t.title,t.body,t.meta]),JSON.stringify(['공지','내용','']));
});
test('보고서를 열면 내 같은 보고서의 제출 알림만 읽음으로 바뀐다',async()=>{
 const s=setup({ctx:{}});const calls=[];
 s.sandbox.rpc=async(name,args)=>{calls.push([name,args]);return 1;};
 s.run('APP_UPDATES.splice(0)');   // 업데이트 공지는 이 테스트의 배지 숫자에서 뺀다
 s.run(`INBOX.rows=[{id:'a',kind:'REPORT_SUBMITTED',report_id:'r1',read_at:null},{id:'b',kind:'REPORT_SUBMITTED',report_id:'r2',read_at:null},{id:'c',kind:null,report_id:null,url:'./#report=r1&comment=x',read_at:null}]`);
 await s.run(`markReportOpened('r1')`);
 assert.equal(JSON.stringify(calls),JSON.stringify([['cellcare_report_open',{p_report:'r1'}]]));
 assert.equal(s.run('INBOX.rows.filter(n=>!n.read_at).map(n=>n.id).join()'),'b,c');
 assert.equal(s.dom.textContent,'2');
 // DB 적용 전(함수 없음)이면 조용히 넘어가고 알림은 그대로
 s.sandbox.rpc=async()=>{throw new Error('function not found');};
 await s.run(`markReportOpened('r2')`);
 assert.equal(s.run('INBOX.rows.filter(n=>!n.read_at).map(n=>n.id).join()'),'b,c');
});
