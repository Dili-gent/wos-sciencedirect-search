# WoS & ScienceDirect 文献检索 Skill

> 让 AI Agent 通过一个受控的本地 Quark 浏览器，在 **Web of Science 核心合集** 和 **Elsevier ScienceDirect** 里检索文献、抓取元数据。
> 不需要 API Key，复用校园 **CARSI** 登录态；纯 Node.js，**零第三方依赖**。

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A521-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 这是什么

一个 **Agent Skill**：一份 `SKILL.md` 使用说明 + 一组 Node 脚本。

支持 `SKILL.md` 约定的 AI 工具（DeepSeek Harness、Claude Code 等）读取 `SKILL.md` 后，就知道**什么时候**该用这个技能、**怎么**调用这些脚本，不需要你再解释。

## 能做什么

- **Web of Science 检索** —— 关键词或字段检索（`TS=(graphene) AND PY=(2022-2026)` 这类也支持），返回命中总数 + 前 N 条记录：标题、作者、期刊、日期、被引次数、DOI、链接。
- **ScienceDirect 检索** —— 支持年份区间、文献类型（研究论文 / 综述 / 全部）过滤，支持翻页。
- **访问状态自检** —— 一条命令确认机构对两个数据库的授权是否还有效、学校登录态是否过期。
- **全文链接** —— ScienceDirect 返回 `pdf` 字段（有权限时给出可下载的全文链接）。

## 工作原理（一句话）

脚本通过 **CDP**（Chrome DevTools Protocol）驱动一个**独立的** Quark（Chromium 144）实例，端口 `9334`，使用持久化 profile `%LOCALAPPDATA%\WorkBuddyDBSearch\profile`。这个 profile 里保存着学校 CARSI 的登录 Cookie，所以正常路径下**不需要每次重新登录**。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | **Windows**（脚本用 `where` 定位 Quark） |
| 浏览器 | **Quark**（Chromium 144）。自动查找常见安装位置；找不到就设置 `QUARK_EXE` 指向 `quark.exe` |
| Node.js | **≥ 21**（需要内置 `WebSocket`）。无任何 npm 依赖，不用 `npm install` |
| 账号 | 学校的 **CARSI** 账号，且所在机构已订阅 WoS / ScienceDirect |

## 安装

```powershell
# 1. 下载：仓库右上角 Code → Download ZIP，解压

# 2. 放到 Agent 的 skills 目录（二选一）
# DeepSeek Harness
Copy-Item -Recurse .\wos-sciencedirect-search "$env:USERPROFILE\.dsh\skills\"

# Claude Code 等使用 SKILL.md 的工具
Copy-Item -Recurse .\wos-sciencedirect-search "$env:USERPROFILE\.claude\skills\"
```

也可以用 `git clone` 直接克隆到对应目录。

## 首次使用

```powershell
cd "$env:USERPROFILE\.dsh\skills\wos-sciencedirect-search"

node scripts\login.js --school "你的学校在 CARSI 里的显示名"
node scripts\check.js
```

- `login.js` 会打开一个标题为 **【请在这里输入学校账号密码】** 的浏览器窗口，**由你本人**在里面输入账号密码（脚本不接触密码）。
- `check.js` 返回 `{"ok": true, ...}` 才算打通，之后就可以正常检索了。

> `--school` 是**必填**的：填你自己学校在 CARSI 里的显示名。不填的话脚本会打印提示并直接退出（`exit 2`），不会误登到别的学校。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `node scripts\check.js` | 检查两个数据库是否可用、登录态是否有效 |
| `node scripts\wos.js "query" --limit 20 --out wos.json` | 检索 Web of Science |
| `node scripts\els.js "query" --from 2023 --to 2026 --type FLA --limit 20` | 检索 ScienceDirect |
| `node scripts\browser.js status` / `start` / `stop` | 查看、启动、关闭受控浏览器 |
| `node scripts\login.js --school "学校名"` | 登录态过期时重新走 CARSI 登录 |

## 输出

每个脚本向 stdout 打印**一个 JSON 对象**，诊断信息走 stderr。

- `wos.js`：`total` + 记录列表（`title` / `authors` / `journal` / `date` / `cited` / `doi` / `url`）
- `els.js`：记录列表（`title` / `url` / `journal` / `date` / `authors[]` / `doi` / `pii` / `type` / `access` / `pdf`）
- `check.js`：`{ ok, wos: {...}, elsevier: {...} }`

## 已知限制

- **仅 Windows + Quark**：脚本的浏览器发现逻辑是为 Windows 写的。
- **Elsevier 反爬**：连续快速请求会触发验证码，此时脚本返回 `needCaptcha: true`，需要人工在浏览器里点一次再重试。
- **不要用 `fetch()` 下 ScienceDirect 的 PDF**：会被识别为机器人并返回 403，请走浏览器或直接用 `pdf` 链接。
- **Web of Science 是 Angular SPA**：`curl` 只能拿到空壳，必须用真实浏览器。
- 单次调用只取一页；更多结果用 `--offset`（ScienceDirect）或 `--limit`（WoS，速度会变慢）。

## 隐私与安全

- 脚本**从不接收、不处理、不记录**学校密码，登录由你本人在浏览器窗口完成。
- 登录 Cookie 保存在浏览器 profile 目录（`%LOCALAPPDATA%\WorkBuddyDBSearch\profile`），**不在本仓库里**，也请不要把它提交上来。
- 本仓库不含任何账号、Cookie、Token 或个人信息。

## 目录结构

```
wos-sciencedirect-search/
├── SKILL.md                  # Agent 读的说明书（触发条件、工作流、约束）
├── scripts/
│   ├── browser.js            # 启动/停止/查看受控浏览器
│   ├── check.js              # 两个数据库的可用性自检
│   ├── els.js                # ScienceDirect 检索
│   ├── login.js              # CARSI 登录引导
│   ├── wos.js                # Web of Science 检索
│   └── lib/cdp.js            # 共享 CDP 客户端（零依赖）
└── references/
    ├── selectors.md          # 解析依赖的 DOM 选择器
    └── troubleshooting.md    # 症状导向的排错手册
```

## License

[MIT](LICENSE)

---

**English** — An Agent Skill that drives a controlled Quark (Chromium) instance over CDP to search Web of Science Core Collection and ScienceDirect using a saved institutional CARSI session. Zero npm dependencies, Node.js ≥ 21, Windows only. See [SKILL.md](SKILL.md) for the full contract.
