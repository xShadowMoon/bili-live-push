// Delivery: QQ groups through a OneBot 11 HTTP API (e.g. NapCat) and/or a Discord webhook.
// 推送：QQ 群走 OneBot 11 HTTP 接口（比如 NapCat），也可以同时发 Discord。发不出去会重试、去掉图片再试、存起来每 2 分钟补发。
import { log, sleep, rand, today } from './util.mjs';

const KIND_AT_ALL = { live: 'live', video: 'video', dynamic: 'dynamic', reserve: 'reserve', reminder: 'reminder' };

export function createNotifier({ fetchImpl = globalThis.fetch, wait = sleep } = {}) {
  async function sendGroup(cfg, groupId, text, images, atAll) {
    const message = atAll
      ? [{ type: 'at', data: { qq: 'all' } }, { type: 'text', data: { text: '\n' + text } }]
      : [{ type: 'text', data: { text } }];
    if (cfg.withImages) for (const url of images.filter(Boolean)) message.push({ type: 'image', data: { file: url } });
    const res = await fetchImpl(`${cfg.qq.api.replace(/\/$/, '')}/send_group_msg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.qq.token ? { Authorization: `Bearer ${cfg.qq.token}` } : {}) },
      body: JSON.stringify({ group_id: Number(groupId), message }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json().catch(() => ({ status: 'failed', message: `HTTP ${res.status}` }));
    if (body.status !== 'ok') throw new Error(body.message || body.wording || `OneBot 返回 ${body.retcode ?? res.status}`);
    return body.data;
  }

  async function sendDiscord(cfg, post) {
    if (!cfg.discord.webhook) return;
    const mention = cfg.discord.everyone && (cfg.atAll[KIND_AT_ALL[post.kind]] ?? false);
    const image = cfg.withImages ? post.images.find(Boolean) : null;
    const res = await fetchImpl(cfg.discord.webhook, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ username: '开播推送', content: (mention ? '@everyone ' : '') + post.text.slice(0, 1900),
        allowed_mentions: { parse: mention ? ['everyone'] : [] }, embeds: image ? [{ image: { url: image } }] : [] }),
    });
    if (!res.ok) throw new Error(`Discord HTTP ${res.status}`);
  }

  // Send one post everywhere it should go.
  async function announce(cfg, state, post) {
    if (cfg.discord.webhook) {
      try { await sendDiscord(cfg, post); log('INFO', `已发到 Discord：${post.upName}「${post.title}」`); }
      catch (e) { log('WARNING', `发到 Discord 失败：${e.message}`); }
    }
    if (!cfg.qq.groups.length) {
      if (!cfg.discord.webhook) log('WARNING', `没有设置推送目标（qq.groups 或 discord.webhook），「${post.title}」没有发出去`);
      return;
    }
    const atAll = cfg.atAll[KIND_AT_ALL[post.kind]] ?? false;
    for (const [i, g] of cfg.qq.groups.entries()) {
      const sent = state.sent[today(cfg)] ??= {};
      if ((sent[g] ?? 0) >= cfg.dailyLimit) { log('WARNING', `群 ${g} 今天已发 ${cfg.dailyLimit} 条，跳过「${post.title}」`); continue; }
      if (i > 0) await wait(rand(2000, 5000));
      try {
        await sendGroup(cfg, g, post.text, post.images, atAll);
      } catch (e) {
        log('WARNING', `发到群 ${g} 失败（${e.message}），30 秒后重试`);
        await wait(30000);
        if (post.kind === 'live' && post.roomId && !state.live?.[post.roomId]?.live) { log('INFO', '已经下播，不再补开播通知'); continue; }
        try { await sendGroup(cfg, g, post.text, post.images, atAll); }
        catch (e2) {
          // Usually the cover image cannot be uploaded: try text only so the alert still goes out.
          log('WARNING', `还是失败（${e2.message}），改成不带图片再发一次`);
          try { await sendGroup(cfg, g, post.text, [], atAll); }
          catch (e3) {
            log('ERROR', `发到群 ${g} 不带图片也失败：${e3.message}，之后每 2 分钟重试，最多 1 小时`);
            (state.pending ??= []).push({ post, group: g, atAll, since: Date.now(), lastTry: Date.now() });
            continue;
          }
        }
      }
      sent[g] = (sent[g] ?? 0) + 1;
      log('INFO', `已发到群 ${g}${atAll ? '（@全体成员）' : ''}：${post.upName}「${post.title}」`);
    }
  }

  async function retryPending(cfg, state) {
    if (!state.pending?.length) return;
    const keep = [];
    for (const p of state.pending) {
      const stillLive = p.post.kind === 'live' && p.post.roomId ? state.live?.[p.post.roomId]?.live : true;
      if (Date.now() - p.since >= 60 * 60e3 || !stillLive) { log('WARNING', `放弃补发「${p.post.title}」到群 ${p.group}`); continue; }
      if (Date.now() - p.lastTry < 120e3) { keep.push(p); continue; }
      p.lastTry = Date.now();
      try {
        await sendGroup(cfg, p.group, p.post.text, [], p.atAll);
        const sent = state.sent[today(cfg)] ??= {};
        sent[p.group] = (sent[p.group] ?? 0) + 1;
        log('INFO', `已补发到群 ${p.group}：${p.post.upName}「${p.post.title}」`);
      } catch (e) { log('WARNING', `补发到群 ${p.group} 失败：${e.message}`); keep.push(p); }
    }
    state.pending = keep;
  }

  return { announce, retryPending, sendGroup };
}
