import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLive, SAME_SESSION_MS } from '../src/live.mjs';
import { parseFeed, handleNew } from '../src/feed.mjs';
import { createNotifier } from '../src/notify.mjs';

const cfg = {
  streamers: [{ uid: 7, name: '' }], push: { live: true, liveEnd: true, liveChange: true, videos: true, dynamics: true, reserve: true },
  atAll: { live: true }, timeZone: 'Asia/Shanghai', timeLabel: '', withImages: true, dailyLimit: 30, maxAgeHours: 24,
  qq: { api: 'http://onebot', token: 't', groups: ['100'] }, discord: { webhook: '', everyone: false }, reserveRemindMinutes: 10,
};

function harness() {
  let status = { live_status: 0, live_time: 0, title: '标题', room_id: 55, uname: '主播A', area_v2_parent_name: '娱乐', area_v2_name: '唱见' };
  const sent = [];
  const ctx = {
    bili: { getJson: async () => ({ code: 0, data: { 7: status } }) },
    notifier: { announce: async (_c, _s, post) => { sent.push(post); } },
    state: { live: {}, seen: {}, seenDyn: {}, reserve: {}, sent: {}, pending: [] }, names: {}, rooms: {},
  };
  return { ctx, sent, set: patch => { status = { ...status, ...patch }; } };
}

test('first check only records; a new stream is announced once; end needs two offline checks and five minutes', async () => {
  const h = harness();
  await checkLive(cfg, h.ctx);
  assert.equal(h.sent.length, 0);
  h.set({ live_status: 1, live_time: 1000 });
  await checkLive(cfg, h.ctx);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].kind, 'live');
  assert.match(h.sent[0].text, /主播A 开播啦/);
  await checkLive(cfg, h.ctx);
  assert.equal(h.sent.length, 1);
  h.set({ live_status: 0 });
  await checkLive(cfg, h.ctx);
  assert.equal(h.ctx.state.live[55].live, true, 'one offline check is not the end');
  await checkLive(cfg, h.ctx);
  assert.equal(h.ctx.state.live[55].live, false);
  assert.equal(h.sent.length, 1, 'no end message before 5 minutes');
  h.ctx.state.live[55].endedAt -= SAME_SESSION_MS;
  await checkLive(cfg, h.ctx);
  assert.equal(h.sent.at(-1).kind, 'liveEnd');
});

test('restarting the stream within 5 minutes counts as the same stream', async () => {
  const h = harness();
  h.set({ live_status: 1, live_time: 1000 });
  await checkLive(cfg, h.ctx);
  h.set({ live_status: 0 });
  await checkLive(cfg, h.ctx); await checkLive(cfg, h.ctx);
  h.set({ live_status: 1, live_time: 2000 });
  await checkLive(cfg, h.ctx);
  assert.equal(h.sent.length, 0);
});

test('feed parsing: videos, forwards, and first run stays silent', async () => {
  const now = Math.floor(Date.now() / 1000);
  const items = [
    { type: 'DYNAMIC_TYPE_AV', modules: { module_author: { pub_ts: now, name: 'UP' }, module_dynamic: { major: { archive: { bvid: 'BV1', title: '新歌', cover: '//i0/a.jpg' } } } } },
    { type: 'DYNAMIC_TYPE_FORWARD', id_str: '9', modules: { module_author: { pub_ts: now, name: 'UP' }, module_dynamic: { desc: { text: '转一下' } } },
      orig: { modules: { module_author: { name: '别人' }, module_dynamic: { major: { archive: { bvid: 'BV2', title: '原视频' } } } } } },
    { type: 'DYNAMIC_TYPE_LIVE_RCMD', modules: {} },
  ];
  const { videos, dynamics } = parseFeed(cfg, items, '');
  assert.equal(videos[0].id, 'BV1');
  assert.equal(videos[0].images[0], 'https://i0/a.jpg');
  assert.match(dynamics[0].text, /\/\/@别人：【视频】原视频\nhttps:\/\/www\.bilibili\.com\/video\/BV2/);
  assert.equal(dynamics.length, 1);

  const sent = [];
  const ctx = { state: { seen: {}, reserve: {} }, notifier: { announce: async (_c, _s, p) => sent.push(p) } };
  await handleNew(cfg, ctx, 7, 'seen', videos);
  assert.equal(sent.length, 0);
  await handleNew(cfg, ctx, 7, 'seen', [{ ...videos[0], id: 'BV3' }, ...videos]);
  assert.deepEqual(sent.map(p => p.id), ['BV3']);
});

test('QQ send falls back to text only when images fail', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const hasImage = body.message.some(s => s.type === 'image');
    return new Response(JSON.stringify(hasImage ? { status: 'failed', message: 'image upload failed' } : { status: 'ok', data: { message_id: 1 } }));
  };
  const n = createNotifier({ fetchImpl, wait: async () => {} });
  const state = { live: { 55: { live: true } }, sent: {}, pending: [] };
  await n.announce(cfg, state, { kind: 'live', roomId: 55, upName: 'A', title: 't', text: 'hello', images: ['https://x/y.jpg'] });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].message[0].type, 'at');
  assert.ok(!calls[2].message.some(s => s.type === 'image'));
  assert.equal(Object.values(state.sent)[0]['100'], 1);
  assert.equal(state.pending.length, 0);
});
