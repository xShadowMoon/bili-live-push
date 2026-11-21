#!/usr/bin/env node
// B站主播开播 / 下播 / 改标题 / 新视频 / 新动态 / 直播预约 → 推送到 QQ 群（OneBot，比如 NapCat）和 Discord。
//
//   node index.mjs           一直运行
//   node index.mjs --dry     只查一次并打印看到的东西，不推送、不改状态
//   node index.mjs --once    查一次就退出（适合放进计划任务）
//   node index.mjs login     扫码登录一个 B站小号（可选：登录后动态更稳定，不容易拿到空列表）
//   node index.mjs test      往每个 QQ 群 / Discord 发一条测试消息
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBili, showQrInTerminal } from './src/bili.mjs';
import { createNotifier } from './src/notify.mjs';
import { checkLive } from './src/live.mjs';
import { checkFeed, checkReserves } from './src/feed.mjs';
import { loadConfig, log, readJson, writeJson, sleep } from './src/util.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const cfgFile = path.resolve(DIR, args.includes('--config') ? args[args.indexOf('--config') + 1] : 'config.json');
const DRY = args.includes('--dry'), ONCE = args.includes('--once') || DRY;

async function main() {
  const cfg = loadConfig(cfgFile, DIR);
  const bili = createBili({ loginFile: cfg.loginFile, log });
  const notifier = createNotifier();

  if (args[0] === 'login') {
    const { uid } = await bili.qrLogin(showQrInTerminal);
    log('INFO', `登录成功（UID ${uid}），存在 ${cfg.loginFile}`);
    return;
  }

  const stateFile = path.join(cfg.dataDir, 'state.json');
  const state = { live: {}, seen: {}, seenDyn: {}, reserve: {}, sent: {}, pending: [], ...readJson(stateFile, {}) };
  const ctx = { bili, notifier, state, dry: DRY, names: {}, rooms: {} };
  const save = () => { if (!DRY) { for (const d of Object.keys(state.sent).sort().slice(0, -7)) delete state.sent[d]; writeJson(stateFile, state); } };

  if (args[0] === 'test') {
    await notifier.announce({ ...cfg, dailyLimit: Infinity }, { ...state, sent: {} }, { kind: 'test', upName: '测试', title: '测试消息', text: '【测试】开播推送能发到这里 ✅', images: [] });
    return;
  }

  const jobs = [
    { name: '开播', every: cfg.intervals.liveSec, run: () => checkLive(cfg, ctx) },
    { name: '视频/动态', every: cfg.intervals.feedSec, run: () => checkFeed(cfg, ctx) },
    { name: '直播预约', every: cfg.intervals.reserveSec, run: () => checkReserves(cfg, ctx) },
  ].map(j => ({ ...j, next: 0, fails: 0 }));
  log('INFO', `开始监控 ${cfg.streamers.map(s => s.name || s.uid).join('、')}${DRY ? '（只看不发）' : ''}`);
  if (!bili.currentLogin()) log('INFO', '没有登录B站（可选）：动态偶尔会查不到，想更稳就运行 node index.mjs login');

  for (;;) {
    for (const j of jobs) {
      if (Date.now() < j.next) continue;
      try {
        await j.run();
        if (j.fails >= 3) log('INFO', `${j.name}检查恢复正常`);
        j.fails = 0;
        j.next = Date.now() + j.every * 1000;
      } catch (e) {
        // Back off on repeated errors so we don't hammer Bilibili while it is rate-limiting us.
        j.fails++;
        if (j.fails <= 3 || j.fails % 10 === 0) log('WARNING', `${j.name}检查出错（第 ${j.fails} 次）：${e.message}`);
        j.next = Date.now() + Math.min(j.every * 2 ** Math.min(j.fails, 4), 3600) * 1000;
      }
      save();
    }
    try { await notifier.retryPending(cfg, state); save(); } catch (e) { log('WARNING', `补发出错：${e.message}`); }
    if (ONCE) return;
    await sleep(5000);
  }
}

main().catch(e => { log('ERROR', e.message); process.exit(1); });
