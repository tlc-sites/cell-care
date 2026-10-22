import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const routes = require('../notification-route.js');
const id = '10000000-0000-4000-8000-000000000001';
test('알림 종류마다 해당 보고·메시지·동정·공지로 연결한다', () => {
  for (const [tag,kind] of [['submit-','report'],['msg-','thread'],['note-','note'],['notice-','notice']]) {
    assert.equal(routes.parse(routes.url({ tag: tag + id })).kind, kind);
    assert.equal(routes.parse(routes.url({ tag: tag + id })).id, id);
  }
  assert.equal(routes.url({ tag: 'pmsg-' + id }), './#report=' + id + '&target=pastor_msg');
  assert.deepEqual(routes.parse('./#report=' + id + '&comment=' + id), { kind:'report',id,comment:id });
  assert.deepEqual(routes.parse('./#report=' + id + '&talk=' + id), { kind:'report',id,comment:null,talk:id });
  assert.equal(routes.url({ tag:'talk-' + id, url:'./#report=' + id + '&talk=' + id }), './#report=' + id + '&talk=' + id);
  assert.equal(routes.parse('#report=wrong'), null);
  assert.equal(routes.url({ tag:'test',url:'https://example.com/' }), './#section=notifications');
});
test('열린 앱에는 이동 메시지를 보내고 외부 주소를 열지 않는다', async () => {
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const handlers = {}, messages = [], opened = [];
  const client = { url:'https://app.example/',postMessage:x=>messages.push(x),focus:async()=>{} };
  const self = { registration:{ scope:'https://app.example/' },clients:{ matchAll:async()=>[client],openWindow:async url=>opened.push(url) },addEventListener:(k,f)=>handlers[k]=f };
  vm.runInNewContext(source,{ self,importScripts:()=>{},CellCareRoutes:routes,URL });
  let done;
  handlers.notificationclick({ notification:{ close(){},data:{url:'./#report='+id} },waitUntil:p=>done=p });
  await done;
  assert.equal(messages[0].url,'https://app.example/#report='+id);
  self.clients.matchAll=async()=>[];
  handlers.notificationclick({ notification:{ close(){},data:{url:'https://evil.example/'} },waitUntil:p=>done=p });
  await done;
  assert.deepEqual(opened,['https://app.example/']);
});
