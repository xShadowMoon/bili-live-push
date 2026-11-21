import fs from 'node:fs';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
export const https = u => String(u ?? '').replace(/^http:/, 'https:').replace(/^\/\//, 'https://');
export const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

// "2026-10-17 23:22（北京时间）"
export function fmtTime(cfg, unixSeconds) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: cfg.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(unixSeconds * 1000)).map(x => [x.type, x.value]));
  const label = cfg.timeLabel ? `（${cfg.timeLabel}）` : '';
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${label}`;
}

export const today = cfg => new Date().toLocaleDateString('sv-SE', { timeZone: cfg.timeZone });

export function log(level, text) { console.log(`${new Date().toLocaleString('sv-SE')} ${level} ${text}`); }

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

const DEFAULTS = {
  streamers: [],
  intervals: { liveSec: 60, feedSec: 300, reserveSec: 600 },
  push: { live: true, liveEnd: true, liveChange: true, videos: true, dynamics: true, reserve: true },
  atAll: { live: true, video: false, dynamic: false, reserve: false, reminder: false },
  reserveRemindMinutes: 10,
  timeZone: 'Asia/Shanghai',
  timeLabel: '北京时间',
  withImages: true,
  dailyLimit: 30,
  maxAgeHours: 24,
  qq: { api: 'http://127.0.0.1:3000', token: '', groups: [] },
  discord: { webhook: '', everyone: false },
  dataDir: 'data',
  loginFile: 'bili-login.json',
};

export function loadConfig(file, base) {
  const raw = readJson(file, null);
  if (!raw) throw new Error(`读不到 ${file}：照 config.example.json 复制一份，填上要关注的主播 UID 和推送目标`);
  const cfg = { ...DEFAULTS, ...raw };
  for (const k of ['intervals', 'push', 'atAll', 'qq', 'discord']) cfg[k] = { ...DEFAULTS[k], ...(raw[k] ?? {}) };
  cfg.streamers = (cfg.streamers ?? []).map(s => ({ uid: Number(s.uid), name: String(s.name ?? '') })).filter(s => s.uid > 0);
  if (!cfg.streamers.length) throw new Error('config.json 的 streamers 里至少写一个主播：[{ "uid": 主播的B站UID }]');
  cfg.qq.groups = (cfg.qq.groups ?? []).map(String).filter(Boolean);
  cfg.dataDir = path.resolve(base, cfg.dataDir);
  cfg.loginFile = path.resolve(cfg.dataDir, cfg.loginFile);
  return cfg;
}
