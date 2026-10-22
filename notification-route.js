(function (root) {
  'use strict';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function parse(value) {
    const p = new URLSearchParams(String(value || '').replace(/^.*?#/, ''));
    for (const key of ['report', 'thread', 'note', 'notice']) {
      if (uuid.test(p.get(key) || '')) {
        const route = { kind: key, id: p.get(key), comment: uuid.test(p.get('comment') || '') ? p.get('comment') : null };
        if (key === 'report' && uuid.test(p.get('talk') || '')) route.talk = p.get('talk');   // 보고서 대화 글
        return route;
      }
    }
    const section = p.get('section');
    return ['leader', 'leadership', 'senior', 'admin', 'notifications'].includes(section) ? { kind: 'section', id: section } : null;
  }
  function url(payload) {
    if (payload.url && parse(payload.url)) return './#' + payload.url.split('#')[1];
    const tag = String(payload.tag || '');
    const id = tag.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (id && /^(submit-|pmsg-)/.test(tag)) return './#report=' + id + (tag.startsWith('pmsg-') ? '&target=pastor_msg' : '');
    if (id && tag.startsWith('msg-')) return './#thread=' + id;
    if (id && tag.startsWith('note-')) return './#note=' + id;
    if (id && tag.startsWith('notice-')) return './#notice=' + id;
    const section = tag.startsWith('lr-') ? 'leadership' : tag.startsWith('senior-') ? 'senior' : /^(access-request|login-alert)/.test(tag) ? 'admin' : /^(care-|report-)/.test(tag) ? 'leader' : 'notifications';
    return './#section=' + section;
  }
  const api = { parse, url };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CellCareRoutes = api;
})(typeof globalThis === 'undefined' ? self : globalThis);
