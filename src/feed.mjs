// New videos, dynamics (posts) and live reservations.
// 视频和动态都从「动态」列表里拿（投稿视频也在动态里），每个主播一次请求，更不容易被限制。
import { DM } from './bili.mjs';
import { clip, fmtTime, https, log, rand, sleep } from './util.mjs';

// These are not pushed: live dynamics are handled by the live check, NONE means deleted.
const SKIP_DYNAMIC = new Set(['DYNAMIC_TYPE_LIVE_RCMD', 'DYNAMIC_TYPE_LIVE', 'DYNAMIC_TYPE_NONE']);
export const reserveTitle = r => String(r.name ?? '').replace(/^直播预约[:：]\s*/, '');

export function dynamicContent(item) {
  const dyn = item?.modules?.module_dynamic ?? {};
  const major = dyn.major ?? {};
  const opus = major.opus;
  const text = [opus?.title, opus?.summary?.text ?? dyn.desc?.text].filter(Boolean).join('\n');
  const archive = major.archive ? `【视频】${major.archive.title}` : '';
  const images = (opus?.pics ?? []).map(p => p.url)
    .concat((major.draw?.items ?? []).map(p => p.src))
    .concat(major.archive?.cover ? [major.archive.cover] : [])
    .concat(major.article?.covers ?? []);
  return { text: text || archive || (major.article?.title ?? ''), images: images.map(https) };
}

// The forwarded original: say what it is (video, article, live, deleted) and link videos/articles.
export function origContent(orig) {
  const major = orig?.modules?.module_dynamic?.major ?? {};
  const own = dynamicContent(orig);
  if (orig?.type === 'DYNAMIC_TYPE_NONE' || major.none) return { text: major.none?.tips || '原动态已被删除', link: '', images: [] };
  if (major.archive) return { text: `【视频】${major.archive.title}`, link: `https://www.bilibili.com/video/${major.archive.bvid}`, images: own.images };
  if (major.article) return { text: `【专栏】${major.article.title}`, link: https(major.article.jump_url), images: own.images };
  if (major.live_rcmd) {
    let title = '';
    try { title = JSON.parse(major.live_rcmd.content).live_play_info?.title ?? ''; } catch {}
    return { text: `【直播】${title}`, link: '', images: own.images };
  }
  return { ...own, link: '' };
}

export function parseFeed(cfg, items, fallbackName) {
  const videos = [], dynamics = [];
  for (const it of items) {
    const created = it.modules?.module_author?.pub_ts ?? 0;
    const name = fallbackName || it.modules?.module_author?.name || '';
    const archive = it.modules?.module_dynamic?.major?.archive;
    if (it.type === 'DYNAMIC_TYPE_AV' && archive?.bvid) {
      videos.push({ id: archive.bvid, kind: 'video', created, upName: name, title: archive.title,
        text: `【视频更新】${name} 发布了新视频！\n标题：${archive.title}\n发布时间：${fmtTime(cfg, created)}\nhttps://www.bilibili.com/video/${archive.bvid}`,
        images: [https(archive.cover)] });
      continue;
    }
    if (SKIP_DYNAMIC.has(it.type)) continue;
    const own = dynamicContent(it);
    let body = clip(own.text || '（无文字）', 150), images = own.images, verb = '发布了新动态';
    if (it.type === 'DYNAMIC_TYPE_FORWARD' && it.orig) {
      const orig = origContent(it.orig), who = it.orig.modules?.module_author?.name;
      verb = '转发了动态';
      body = `${clip(own.text || '转发动态', 100)}\n//${who ? `@${who}：` : ''}${clip(orig.text || '（无文字）', 150)}${orig.link ? `\n${orig.link}` : ''}`;
      images = orig.images;
    }
    // A reservation attached to the post is announced with it, not again on its own.
    const add = it.modules?.module_dynamic?.additional;
    const reserve = add?.type === 'ADDITIONAL_TYPE_RESERVE' ? add.reserve : null;
    if (reserve) body += `\n📅 ${reserve.title ?? '直播预约'}${reserve.desc1?.text ? `（${reserve.desc1.text}）` : ''}`;
    dynamics.push({ id: it.id_str, kind: 'dynamic', created, upName: name, reserveSid: reserve?.rid ? Number(reserve.rid) : null,
      title: clip((own.text || verb).replace(/\s+/g, ' '), 30),
      text: `【动态更新】${name} ${verb}！\n${body}\n发布时间：${fmtTime(cfg, created)}\nhttps://t.bilibili.com/${it.id_str}`,
      images: images.slice(0, 3) });
  }
  return { videos, dynamics };
}

export async function fetchFeed(cfg, bili, s, wait = sleep) {
  const url = () => 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?' +
    bili.signWbi({ offset: '', host_mid: s.uid, timezone_offset: -480, platform: 'web',
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,forwardListHidden,decorationCard,commentsNewVersion,onlyfansAssetsV2,ugcDelete,onlyfansQaCard',
      web_location: '333.1387', ...DM });
  let data = await bili.api(s.uid, 'dynamic', url);
  if (!data.items?.length) { await wait(rand(4000, 8000)); data = await bili.api(s.uid, 'dynamic', url); }
  if (!data.items?.length) { bili.noteEmptyFeed(); throw new Error('B站返回的动态列表是空的'); }
  bili.resetEmptyFeed();
  return parseFeed(cfg, data.items, s.name);
}

// First run: remember what exists and push nothing. Later: push only new and recent items, oldest first.
export async function handleNew(cfg, ctx, uid, bucket, posts) {
  const { state } = ctx, label = bucket === 'seen' ? '视频' : '动态';
  const seen = state[bucket][uid];
  if (!seen) {
    state[bucket][uid] = posts.map(p => p.id);
    log('INFO', `开始监控 ${posts[0]?.upName || uid} 的${label}，最新：「${posts[0]?.title ?? '无'}」`);
    return;
  }
  const fresh = posts.filter(p => !seen.includes(p.id)).sort((a, b) => a.created - b.created);
  for (const p of fresh) {
    seen.unshift(p.id);
    if (Date.now() / 1000 - p.created > cfg.maxAgeHours * 3600) { log('INFO', `「${p.title}」是 ${cfg.maxAgeHours} 小时前的旧${label}（可能刚取消隐藏/置顶），不推送`); continue; }
    log('INFO', `发现新${label}：${p.upName}「${p.title}」${p.id}`);
    if (p.reserveSid) { const rs = state.reserve[uid] ??= { seen: [], reminded: [] }; if (!rs.seen.includes(p.reserveSid)) rs.seen.unshift(p.reserveSid); }
    await ctx.notifier.announce(cfg, state, p);
  }
  state[bucket][uid] = seen.slice(0, 100);
}

export async function checkFeed(cfg, ctx) {
  if (!cfg.push.videos && !cfg.push.dynamics) return;
  for (const [i, s] of cfg.streamers.entries()) {
    if (i > 0) await sleep(rand(3000, 8000));
    const { videos, dynamics } = await fetchFeed(cfg, ctx.bili, s);
    const name = videos[0]?.upName || dynamics[0]?.upName;
    if (name) ctx.names[s.uid] ??= name;
    if (ctx.dry) {
      for (const [tag, list] of [['视频', videos], ['动态', dynamics]]) list.forEach(p => console.log(`  [${tag}] ${fmtTime(cfg, p.created)}  ${p.id}  ${p.title}`));
      continue;
    }
    if (cfg.push.videos) await handleNew(cfg, ctx, s.uid, 'seen', videos);
    if (cfg.push.dynamics) await handleNew(cfg, ctx, s.uid, 'seenDyn', dynamics);
  }
}

// Live reservations: announce new ones; remind N minutes before the planned start if not live yet.
export async function checkReserves(cfg, ctx) {
  if (!cfg.push.reserve) return;
  const { state } = ctx;
  for (const s of cfg.streamers) {
    const body = await ctx.bili.getJson(`https://api.bilibili.com/x/space/reservation?vmid=${s.uid}`, { Referer: `https://space.bilibili.com/${s.uid}` });
    if (body.code !== 0) throw new Error(`预约接口返回 ${body.code} ${body.message}`);
    const list = (body.data ?? []).filter(r => r.type === 2 && r.state === 100 && r.live_plan_start_time);   // type 2 = live, state 100 = open
    const name = s.name || ctx.names[s.uid] || String(s.uid);
    if (ctx.dry) { list.forEach(r => console.log(`  [预约] ${name}  ${fmtTime(cfg, r.live_plan_start_time)}  ${reserveTitle(r)}（${r.total} 人预约）`)); continue; }
    const first = !state.reserve[s.uid];
    const st = state.reserve[s.uid] ??= { seen: [], reminded: [] };
    const roomId = ctx.rooms[s.uid];
    for (const r of list) {
      if (!st.seen.includes(r.sid)) {
        st.seen.unshift(r.sid);
        if (first) log('INFO', `开始监控 ${name} 的直播预约，已有：「${reserveTitle(r)}」`);
        else {
          log('INFO', `发现直播预约：${name}「${reserveTitle(r)}」`);
          await ctx.notifier.announce(cfg, state, { id: `reserve-${r.sid}`, kind: 'reserve', created: r.stime ?? 0, upName: name, title: reserveTitle(r),
            text: `【直播预约】${name} 预约了直播！\n标题：${reserveTitle(r)}\n开播时间：${fmtTime(cfg, r.live_plan_start_time)}\n已有 ${r.total ?? 0} 人预约：https://space.bilibili.com/${s.uid}`,
            images: [] });
        }
      }
      const left = r.live_plan_start_time * 1000 - Date.now();
      const isLive = roomId && state.live[roomId]?.live;
      if (left <= cfg.reserveRemindMinutes * 60e3 && left > -5 * 60e3 && !isLive && !st.reminded.includes(r.sid)) {
        st.reminded.unshift(r.sid);
        const link = roomId ? `https://live.bilibili.com/${roomId}` : `https://space.bilibili.com/${s.uid}`;
        log('INFO', `开播预告：${name}「${reserveTitle(r)}」`);
        await ctx.notifier.announce(cfg, state, { id: `remind-${r.sid}`, kind: 'reminder', created: r.live_plan_start_time, upName: name, title: reserveTitle(r),
          text: `【开播预告】${name} 还有 ${cfg.reserveRemindMinutes} 分钟开播！\n标题：${reserveTitle(r)}\n开播时间：${fmtTime(cfg, r.live_plan_start_time)}\n${link}`,
          images: [] });
      }
    }
    st.seen = st.seen.slice(0, 50);
    st.reminded = st.reminded.slice(0, 50);
  }
}
