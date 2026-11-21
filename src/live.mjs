// Stream start / end / title-or-area change detection for all configured streamers in one request.
// 开播、下播、直播中改标题或换分区。下播 5 分钟内又开播算同一场；网络抖一下查到一次「未开播」不算下播。
import { fmtTime, https, log } from './util.mjs';

export const SAME_SESSION_MS = 5 * 60e3;
export const areaText = info => [info.area_v2_parent_name, info.area_v2_name].filter(Boolean).join(' · ');

// { uid: { live_status, live_time, title, cover_from_user, keyframe, room_id, uname, area_v2_* } }
export async function fetchLive(bili, uids) {
  const body = await bili.getJson('https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids',
    { 'Content-Type': 'application/json', Referer: 'https://live.bilibili.com/' },
    { method: 'POST', body: JSON.stringify({ uids: uids.map(Number) }) });
  if (body.code !== 0) throw new Error(`直播接口返回 ${body.code} ${body.message}`);
  return body.data ?? {};
}

export function livePost(cfg, name, info) {
  const startedAt = info.live_time || Math.floor(Date.now() / 1000);
  const area = areaText(info) ? `分区：${areaText(info)}\n` : '';
  return {
    id: `live-${info.room_id}-${startedAt}`, kind: 'live', roomId: info.room_id, created: startedAt, upName: name, title: info.title,
    text: `【开播提醒】${name} 开播啦！\n标题：${info.title}\n${area}开播时间：${fmtTime(cfg, startedAt)}\nhttps://live.bilibili.com/${info.room_id}`,
    images: [https(info.cover_from_user || info.keyframe)],
  };
}

export function liveChangePost(roomId, name, before, after) {
  const titleChanged = after.title !== before.title, areaChanged = after.area !== before.area;
  const what = titleChanged && areaChanged ? '改了标题，还换了分区' : titleChanged ? '改了直播标题' : '换分区了';
  return {
    id: `change-${roomId}-${Date.now()}`, kind: 'liveChange', roomId, created: Math.floor(Date.now() / 1000), upName: name,
    title: `直播间${what}：「${after.title}」`,
    text: `【直播间更新】${name} ${what}\n标题：${after.title}\n分区：${after.area}${areaChanged && before.area ? `（原来是 ${before.area}）` : ''}\nhttps://live.bilibili.com/${roomId}`,
    images: [],
  };
}

export function fmtDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  return h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
}

export function liveEndPost(cfg, roomId, name, st) {
  const end = Math.floor(st.endedAt / 1000);
  return {
    id: `end-${roomId}-${st.sessionStart}`, kind: 'liveEnd', created: end, upName: name, title: `下播 ${st.lastTitle ?? ''}`,
    text: `【下播】${name} 下播啦，辛苦了～\n标题：${st.lastTitle ?? ''}\n本场时长：${fmtDuration(end - st.sessionStart)}\n` +
      `开播：${fmtTime(cfg, st.sessionStart)}\n下播：${fmtTime(cfg, end)}`,
    images: [],
  };
}

// A changed title/area is announced once it has been stable for a minute; at most 3 per stream, 10 minutes apart.
async function checkLiveChange(cfg, ctx, roomId, name, info, st) {
  const now = { title: info.title, area: areaText(info) || st.shown?.area || '' };
  if (!st.shown || st.shownStart !== st.sessionStart) { Object.assign(st, { shown: now, shownStart: st.sessionStart, changes: 0, change: null }); return; }
  if (now.title === st.shown.title && now.area === st.shown.area) { st.change = null; return; }
  if (st.change?.title !== now.title || st.change?.area !== now.area) { st.change = { ...now, since: Date.now() }; return; }
  if (Date.now() - st.change.since < 60e3) return;
  if (st.changes >= 3) { st.shown = now; st.change = null; return; }
  if (Date.now() - (st.changedAt ?? 0) < 10 * 60e3) return;
  const post = liveChangePost(roomId, name, st.shown, now);
  Object.assign(st, { shown: now, change: null, changes: st.changes + 1, changedAt: Date.now() });
  log('INFO', `${name} ${post.title}`);
  if (cfg.push.liveChange) await ctx.notifier.announce(cfg, ctx.state, post);
}

export async function checkLive(cfg, ctx) {
  if (!cfg.push.live && !cfg.push.liveEnd && !cfg.push.liveChange) return;
  const data = await fetchLive(ctx.bili, cfg.streamers.map(s => s.uid));
  const { state } = ctx;
  for (const s of cfg.streamers) {
    const info = data[s.uid];
    if (!info) continue;
    const name = s.name || info.uname;
    ctx.names[s.uid] = name;
    ctx.rooms[s.uid] = info.room_id;
    if (ctx.dry) { console.log(`  [直播] ${name}  ${info.live_status === 1 ? `直播中，开播时间 ${fmtTime(cfg, info.live_time)}` : '未开播'}  ${info.title}`); continue; }
    const key = info.room_id, first = !state.live[key];
    const st = state.live[key] ??= { live: false, offline: 0, endedAt: 0, notifiedLiveTime: 0 };
    if (info.live_status === 1) {
      st.offline = 0;
      st.lastTitle = info.title;
      if (first) {
        // Already live when we start watching: remember it, don't announce (avoids duplicates after a restart).
        Object.assign(st, { live: true, notifiedLiveTime: info.live_time, sessionStart: info.live_time });
        log('INFO', `开始监控 ${name} 的直播，现在正在播`);
      } else if (info.live_time !== st.notifiedLiveTime) {
        const sameSession = st.endedAt && Date.now() - st.endedAt < SAME_SESSION_MS;
        st.notifiedLiveTime = info.live_time;
        if (sameSession) log('INFO', `${name} 刚下播 5 分钟内又开播，算同一场，不发`);
        else {
          st.sessionStart = info.live_time;
          log('INFO', `${name} 开播了：「${info.title}」`);
          if (cfg.push.live) { st.live = true; await ctx.notifier.announce(cfg, state, livePost(cfg, name, info)); }
        }
      }
      st.live = true;
      st.summaryPending = false;
      if (!first) await checkLiveChange(cfg, ctx, key, name, info, st);
    } else {
      if (first) log('INFO', `开始监控 ${name} 的直播，现在没在播`);
      if (st.live && ++st.offline >= 2) {
        Object.assign(st, { live: false, endedAt: Date.now(), summaryPending: !!st.sessionStart });
        log('INFO', `${name} 下播了`);
      }
      // Only send "stream ended" once it has stayed offline for 5 minutes (reconnects count as the same stream).
      if (st.summaryPending && Date.now() - st.endedAt >= SAME_SESSION_MS) {
        st.summaryPending = false;
        if (cfg.push.liveEnd) await ctx.notifier.announce(cfg, state, liveEndPost(cfg, key, name, st));
        st.sessionStart = 0;
      }
    }
  }
}
