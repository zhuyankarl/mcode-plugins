# mcode-plugins

明殊自用的两个 MiniMax Code 插件，公开托管，供**换机 / 家里那台电脑**一键还原。

| 插件 | 类型 | 干什么 |
| --- | --- | --- |
| [`plugins/groundtruth`](plugins/groundtruth) — **Groundtruth 证据守门** | 普通插件（2 个 Skill + 4 个 Hook） | 给高幻觉倾向模型加装证据契约：会话启动注入弃权与出处规程，收尾时对伪造路径、无证据的完成声明做确定性拦截，数值结论强制回源到实际表格单元格。 |
| [`plugins/evidence-guard`](plugins/evidence-guard) — **Evidence Guard 证据守门** | 普通插件（2 个 Skill，无 Hook） | `groundtruth` 的**市场版**：同样的两个 Skill 和零依赖取数脚本，但不带 Hook——官方投稿表单不受理 Hook。两者共用 `scripts/probe-table.mjs`、`scripts/lib/xlsx.mjs`、`scripts/lib/csv.mjs` 与 `tests/probe-table.test.mjs`，由校验器强制逐字节一致。 |
| [`plugins/submission-workbench`](plugins/submission-workbench) — **插件上架材料工作台** | Mini App（页面 + Node 服务） | 填写插件清单与上架信息，逐项核对名称、版本、必填字段与内容一致性，生成可审核的上架材料包，并标出缺失项。 |

三个包都是**零第三方依赖**（只用 Node.js 内置模块），不含密钥、不含平台专属二进制、不含安装脚本。

---

## 在家里的电脑上安装

### 方式一：一键脚本（推荐）

**Windows（PowerShell）**

```powershell
git clone https://github.com/zhuyankarl/mcode-plugins.git
cd mcode-plugins
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**macOS / Linux**

```bash
git clone https://github.com/zhuyankarl/mcode-plugins.git
cd mcode-plugins
bash install.sh
```

脚本会：

1. 把两个插件目录复制到 MiniMax Code 的用户级插件目录
   （Windows：`%USERPROFILE%\.minimax\plugins`；macOS/Linux：`~/.minimax/plugins`）；
2. 同名目录已存在时，先备份成 `<name>.bak-<时间戳>`，不静默覆盖你的改动；
3. 跑一遍安装后自检：node 是否可用、manifest 与 icon 是否齐全、
   `SessionStart` Hook 是否真的吐出证据契约 JSON。

装完 **重启 MiniMax Code**（插件内容在会话启动时加载，不重启不生效），
在插件管理里确认两个插件已启用。新开一个会话，开头应能看到「Groundtruth 证据契约」被注入。

### 方式二：图形界面导入（Mini App）

插件市场 →「创建」→ Mini App →「从 Git 仓库导入」，填：

```
https://github.com/zhuyankarl/mcode-plugins/tree/main/plugins/submission-workbench
```

预览里核对包名、版本、来源目录和 commit，点「导入」。导入完成后进插件管理确认已启用，
再按常规方式打开页面。**导入不跟随分支自动更新**，要升级就重新导入新 commit。

> `groundtruth` 是普通插件（带 Hook），没有「从 Git 仓库导入」入口，请用方式一，
> 或手动把 `plugins/groundtruth` 整个目录（含隐藏的 `.minimax-plugin`）复制到
> `<dataDir>/plugins/groundtruth/`。

---

## 前置条件

- **Node.js LTS**（任意版本，测试环境为 v24）。`groundtruth` 的 Hook 是 Node 脚本，
  Mini App 的 Node 载荷也是 Node 进程。
- MiniMax Code **v3.1.11 或更新**（从 Git 仓库导入 Mini App 的最低版本要求）。

### node 路径的跨机处理

`groundtruth` 的 Hook 曾经把 `C:\Program Files\nodejs\node.exe` 写死在 `hooks.json` 里，
换机器就会哑掉。**v1.1.0 起不再写死**：

- Windows：`commandWindows` 改为调用包内的 `scripts/run-hook.cmd`，
  由它自己找 node —— 先查 PATH 上的 `node.exe`，再依次兜底
  `%ProgramFiles%\nodejs`、`%ProgramFiles(x86)%\nodejs`、`%LOCALAPPDATA%\Programs\nodejs`、
  `%APPDATA%\nvm`、`%ProgramData%\nvm`；
- 其他平台：走 `command`，直接用 PATH 上的 `node`。

所以拷到任何一台机器都不需要改配置。唯一前提是那台机器装了 Node.js。

---

## 目录结构

```text
mcode-plugins/
├── README.md
├── LICENSE                     # MIT
├── install.ps1                 # Windows 一键安装 + 自检
├── install.sh                  # macOS / Linux 一键安装 + 自检
├── tools/
│   ├── validate-packages.mjs   # 全仓包校验（含两版共享文件一致性）
│   ├── build-listing-package.mjs  # 上架材料自检 + 生成投稿 ZIP
│   └── make-dd-xlsx.mjs        # 造一个 data descriptor 的 xlsx 当夹具
└── plugins/
    ├── groundtruth/            # 本地完整版（含 Hook）
    │   ├── .minimax-plugin/plugin.json
    │   ├── icon.png, icon-dark.png
    │   ├── hooks/hooks.json
    │   ├── skills/evidence-contract/SKILL.md
    │   ├── skills/number-grounding/SKILL.md
    │   ├── references/failure-modes.md
    │   ├── tests/probe-table.test.mjs
    │   └── scripts/            # hook-*.mjs, probe-table.mjs, run-hook.cmd, lib/
    ├── evidence-guard/         # 官方市场版（纯 Skill，无 Hook）
    │   ├── .minimax-plugin/plugin.json
    │   ├── icon.png
    │   ├── README.md, LICENSE
    │   ├── skills/…, references/…
    │   ├── tests/probe-table.test.mjs
    │   └── scripts/probe-table.mjs, lib/
    └── submission-workbench/
        ├── .minimax-plugin/plugin.json
        ├── package.json         # mcode.miniApp 声明入口
        ├── icon.png
        ├── README.md            # 英文说明（社区仓库主文档）
        ├── README.zh-CN.md      # 中文说明
        ├── tests/               # 自测与集成测试（不在运行载荷内）
        └── miniapp/
            ├── miniapp.json
            ├── client/          # 页面载荷
            └── node/            # Node 载荷
```

---

## 手动验证

```bash
# groundtruth 的 SessionStart Hook（应输出含 additionalContext 的 JSON）
node plugins/groundtruth/scripts/hook-session.mjs

# groundtruth 的数值回源脚本
node plugins/groundtruth/scripts/probe-table.mjs sheets "<表路径>.xlsx"

# 取数脚本回归测试（两个包各跑一遍）
node --test plugins/groundtruth/tests/probe-table.test.mjs
node --test plugins/evidence-guard/tests/probe-table.test.mjs

# 全仓包校验
node tools/validate-packages.mjs

# 生成市场投稿 ZIP + 自检报告
node tools/build-listing-package.mjs plugins/evidence-guard ../evidence-guard.zip \
  --report ../evidence-guard-listing-report.md

# Mini App 自测
node plugins/submission-workbench/tests/selftest.mjs
```

---

## 版本

| 插件 | 版本 | 说明 |
| --- | --- | --- |
| evidence-guard | 1.2.0 | 官方市场版首次成包。修复两处审核驳回缺陷：CSV 改为按 RFC 4180 解析**全部列**（旧版只取每行第一列，`cell`/`search` 对真实存在的值报「查无此值」）；zip 读取以**中央目录**尺寸为权威（data descriptor 标志位 0x08 的流式归档，旧版会把每个条目读成空）。新增 `lib/csv.mjs` 与回归测试 |
| groundtruth | 1.1.1 | 取数脚本同步修复 CSV 多列读取与 data descriptor 归档解析；示例路径改为通用路径 |
| groundtruth | 1.1.0 | Windows Hook 改为自解析 node 的启动器，移除硬编码绝对路径，可跨机分发；stdin JSON 增加 BOM 容错，避免带 BOM 的管道让校验链静默失效 |
| submission-workbench | 1.1.0 | 测试脚本移出运行载荷（`tests/`），去掉未授权的宿主工具探测，README 拆成英文主文档 + 中文版 |
| submission-workbench | 1.0.0 | 首次发布；插件 id 由 `miniapp-<uuid>` 正式命名为 `submission-workbench` |

包内内容有任何变化都会提升 `version`。

---

## 许可

MIT，见 [LICENSE](LICENSE)。
