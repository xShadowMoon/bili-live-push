<a id="zh"></a>

# bili-live-push 开播推送

**中文** | [English](#english)

盯着 B 站主播，把动静推送到 **QQ 群**（通过任何 OneBot 11 HTTP 接口，比如 [NapCat](https://github.com/NapNeko/NapCatQQ)）和 / 或 **Discord** webhook：

- **开播**：标题、分区、开播时间和封面（可以 `@全体成员`）
- **下播**：直播时长（5 分钟内重新开播算同一场）
- 直播中**改标题或换分区**（稳定一分钟后才推送；每场最多 3 次）
- **新视频**和**新动态**，包括转发和动态里附带的预约
- **直播预约**，以及预约开播前 N 分钟提醒

默认就很稳：重启不会重复推送；QQ 发送失败会重试，再去掉图片重试，还不行就排队，每 2 分钟补发一次，最多一小时；每个群每天有上限；突然又冒出来的旧内容（取消隐藏或置顶）不会推送。

## 需要

- Node.js 20 或更新。没有必需的依赖；`npm install` 只会装 `qrcode`，用来在终端里显示可选的登录二维码。
- QQ：一个用 NapCat（或其他 OneBot 11 实现）登录的 QQ 号，并开启 **HTTP 服务**。把地址和 access token 填到 `qq.api` / `qq.token`。

## 快速开始

```sh
npm install
cp config.example.json config.json   # 填主播 UID、QQ 群号或 Discord webhook
node index.mjs --dry                 # 只查一次、打印看到的东西，不推送
node index.mjs test                  # 往每个群 / Discord 发一条测试消息
node index.mjs                       # 一直运行
```

第一次正式运行只会记下已经有的内容，之后只推送新的。

可选：`node index.mjs login` 用二维码登录一个 B 站小号。B 站有时会给没登录的访客返回空的动态列表，登录后更稳定。这个账号只用来读取。

## 配置（`config.json`）

| 键 | 含义 |
| --- | --- |
| `streamers` | `[{ "uid": 123, "name": "" }]`。`uid` 是主播的 B 站用户 ID（`space.bilibili.com/<uid>` 里的数字）。`name` 用来改显示的名字。 |
| `qq` | `api`（OneBot HTTP 地址）、`token`、`groups`（群号）。 |
| `discord` | `webhook`、`everyone`（QQ 消息 @全体 时，Discord 也 @everyone）。 |
| `push` | 每种推送的开关：`live`、`liveEnd`、`liveChange`、`videos`、`dynamics`、`reserve`。 |
| `atAll` | 哪几种在 QQ 里 @全体成员：`live`、`video`、`dynamic`、`reserve`、`reminder`。 |
| `intervals` | 每次检查间隔的秒数：`liveSec`、`feedSec`、`reserveSec`。别调得太低，不然会被 B 站限流。 |
| `reserveRemindMinutes` | 预约开播前几分钟提醒。 |
| `timeZone`、`timeLabel` | 消息里时间的写法。 |
| `withImages` | 带上封面和动态图片。 |
| `dailyLimit` | 每个群每天最多几条。 |
| `maxAgeHours` | 视频 / 动态第一次出现时，比这个更旧就不推送。 |
| `dataDir`、`loginFile` | 状态和可选登录信息存在哪里（默认 `data/`）。 |

## 一直运行

用什么都行：`pm2 start index.mjs --name bili-live-push`、systemd 服务，或者 Windows 任务计划程序里设成登录时运行 `node index.mjs`。`node index.mjs --once` 查一次就退出，也可以放进 cron。

## 测试

```sh
npm test
```

## 许可

[MIT](LICENSE)。与哔哩哔哩和腾讯无关。请遵守各平台的规则，检查间隔别设得太短。

---

<a id="english"></a>

# English

[中文](#zh) | **English**

Watches Bilibili streamers and pushes updates to **QQ groups** (through any OneBot 11 HTTP API such as [NapCat](https://github.com/NapNeko/NapCatQQ)) and/or a **Discord** webhook:

- **Go-live** with title, area, start time and cover (optionally `@全体成员`)
- **Stream ended** with duration (a reconnect within 5 minutes counts as the same stream)
- **Title or area changed** during a stream (after it has been stable for a minute; at most 3 per stream)
- **New videos** and **new posts (动态)**, including forwards and attached reservations
- **Live reservations** (直播预约) and a reminder N minutes before the planned start

Robust by default: restarts don't re-announce, failed QQ sends are retried, retried without the image, then queued and retried every 2 minutes for an hour; a daily cap per group; old items that suddenly reappear (unhidden or pinned) are not pushed.

## Requirements

- Node.js 20 or newer. No required dependencies; `npm install` only adds `qrcode` to show the optional login QR code in the terminal.
- For QQ: a QQ account logged in with NapCat (or another OneBot 11 implementation) with the **HTTP server** enabled. Put its address and access token in `qq.api` / `qq.token`.

## Quick start

```sh
npm install
cp config.example.json config.json   # fill in streamer UIDs, QQ groups or a Discord webhook
node index.mjs --dry                 # check once and print what it sees, push nothing
node index.mjs test                  # send a test message to every group / Discord
node index.mjs                       # keep running
```

The first real run only records what already exists; from then on only new things are pushed.

Optional: `node index.mjs login` logs in a spare Bilibili account by QR code. Bilibili sometimes returns empty post lists to anonymous visitors; logged-in requests are steadier. The account is only used to read.

## Configuration (`config.json`)

| Key | Meaning |
| --- | --- |
| `streamers` | `[{ "uid": 123, "name": "" }]`. `uid` is the streamer's Bilibili user id (the number in `space.bilibili.com/<uid>`). `name` overrides the display name. |
| `qq` | `api` (OneBot HTTP address), `token`, `groups` (group numbers). |
| `discord` | `webhook`, `everyone` (also ping @everyone when the QQ message would @all). |
| `push` | Turn each kind on or off: `live`, `liveEnd`, `liveChange`, `videos`, `dynamics`, `reserve`. |
| `atAll` | Which kinds @all members in QQ: `live`, `video`, `dynamic`, `reserve`, `reminder`. |
| `intervals` | Seconds between checks: `liveSec`, `feedSec`, `reserveSec`. Don't go too low or Bilibili will rate-limit you. |
| `reserveRemindMinutes` | Remind this many minutes before a reserved stream starts. |
| `timeZone`, `timeLabel` | How times are written in messages. |
| `withImages` | Attach covers and post images. |
| `dailyLimit` | Max messages per group per day. |
| `maxAgeHours` | Ignore videos/posts older than this when they first appear. |
| `dataDir`, `loginFile` | Where state and the optional login are stored (default `data/`). |

## Running it all the time

Use whatever you like: `pm2 start index.mjs --name bili-live-push`, a systemd service, or a Windows Task Scheduler entry that runs `node index.mjs` at logon. `node index.mjs --once` checks once and exits, which also works from cron.

## Tests

```sh
npm test
```

## License

[MIT](LICENSE). Not affiliated with Bilibili or Tencent. Respect the platforms' rules and keep polling intervals reasonable.
