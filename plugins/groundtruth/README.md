# Groundtruth 证据守门

为高幻觉倾向模型（如 MiniMax M3.1-Flash，AA-Omniscience 上幻觉率约 92.8%）加装一层
**可核查**的行为约束：会话开始就注入证据契约，收尾时对"与实际证据冲突"的结论做确定性拦截，
数值结论强制回源到真实表格单元格。

## 为什么需要它

M3.1-Flash 的问题不是"不会"，而是**几乎从不拒答**：56% 的问题答对，但因为每题都硬答，
基准把"答了但错"也计为幻觉，得到 ~92.8% 的幻觉率。这靠更强的检索或更高的推理预算都补不上，
只能靠**结构化的弃权位 + 强制出处 + 确定性校验**来压。

## 安装位置

```
%USERPROFILE%\.minimax\plugins\groundtruth\
```

用户级生效，所有项目都起作用。删除该目录即可完全停用。

## 四个 Hook，分工明确

| 事件 | 作用 | 强度 |
| --- | --- | --- |
| `SessionStart` | 注入 7 条证据契约（三态标注、弃权、出处、数值回源等） | 常驻上下文 |
| `UserPromptSubmit` | 对数据/统计类提问追加一行提醒 | 提醒 |
| `PostToolUse` | 工具失败后提醒"不要用臆测填补空白" | 提醒 |
| `Stop` | 收尾时校验结论是否与磁盘/执行记录矛盾 | **硬拦截** |

## 什么会被硬拦截（只拦确定性的矛盾）

1. **引用了不存在的文件** —— 在当前工作目录与项目目录下都找不到。
2. **引用行号越界** —— 文件存在，但引用行数超过文件实际行数。
3. **声称"测试/构建/运行通过"，但本会话没有执行过任何命令，也没有贴出真实输出。**
4. **给表里的数值下结论，但本会话从未读取过那张表** —— 整场会话的工具调用记录里没有出现过这个文件，
   却给出了具体数字。这条直击"不取数就写数"，是数值类幻觉最常见的成因。

其余一律只是提醒，不打断正常收尾。这是有意的：正则抓"未验证完成语"这类方案在人工标注上
F1 约 0.815，换 LLM judge 会掉到 0.308，硬拦误伤太高。

## 三个硬拦截都不触发时

其余幻觉靠两个 Skill 走流程：

- `groundtruth:evidence-contract` —— claim-to-proof 循环、原子声明逐条对源核验、三态标注格式。
- `groundtruth:number-grounding` —— 数值回源协议，附带零依赖的 xlsx 取数脚本。

## 取数脚本

```bash
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" find 安全红线 --root J:/AOEM-X
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" sheets "<表路径>.xlsx"
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" dump "<表路径>.xlsx" --sheet Sheet1 --max-rows 60
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" cell "<表路径>.xlsx" Sheet1 C7
node "${PLUGIN_ROOT}/scripts/probe-table.mjs" search "<表路径>.xlsx" 钻石
```

输出自带坐标（`表名!Sheet!单元格 = 值`），可直接引用。支持 `.xlsx` / `.csv`；
旧版 BIFF `.xls` 不支持，脚本会明确报错，此时改用 `xlsx` Skill。

## 调参

- **改动不会立刻生效。** 运行时按内容摘要缓存插件包（`v2/plugin-hook-cache/sha256-tree-v1-<摘要>/`）
  并对当前会话持有租约。**改完文件后必须重开会话**（或重启客户端），新版本才会被装载。
  在同一会话里改代码，Hook 跑的还是旧副本——这条坑踩过一次了。
- **PostToolUse 的判定按工具类型分工**：`bash` / `grep` 会在响应**头部 300 字符**内匹配错误特征；
  `read` / `edit` / `write` / `glob` **只认结构化错误字段**（`error` / `is_error` / `success:false`）。
  原因是文件类工具会回显文件内容，而内容里出现"文件找不到""No matches found"这类词很常见——
  整段扫描会把成功调用误判成失败。
- **审计日志**：`${PLUGIN_DATA}/audit.jsonl`，每次收尾检测到的硬/软问题都会留痕，
  用来判断规则是否太松或太紧。
- **重复拦截保护**：同一问题 10 分钟内不重复拦截（`${PLUGIN_DATA}/guard.json`）。
- **改判定强度**：编辑 `scripts/lib/core.mjs` 里的 `HARD_VERIFICATION_CLAIM`、
  `SOFT_CLAIM` 正则，或 `scripts/hook-stop.mjs` 里的 `hard.push(...)` 分支。
- **改契约文本**：编辑 `scripts/lib/contract.mjs` 的 `CONTRACT`。
- **完全停用**：删除本目录，或在 Settings → Hooks 里关掉对应项。

## 与市场版的关系

本地这份是**完整版（含 Hook）**，插件名 `groundtruth`。
上架到官方插件市场的**轻量版（纯 Skill，无 Hook）叫 `evidence-guard`**，
两者名字不同，可以共存；从市场安装 `evidence-guard` 不会覆盖本地的 `groundtruth`。

**上架状态**：`evidence-guard` 已于 2026-11-16 通过官方投稿表单提交，
`submission_id` = `PLUGIN-202611160276`，提交区域 CN、启用端桌面端+云端；
查询进度需「原提交飞书账号 + submission_id + 提交邮箱 545965171@qq.com」三者匹配，
结果由飞书「多维表格助手」机器人回执。台账见 `E:\minimaxworkspace\evidence-guard-submission.md`。

## 分发

整个目录即是一个可分发单元，拷到别人的 `${DATA_DIR}/plugins/` 下即可。
本仓库的 `install.ps1` / `install.sh` 会自动完成这一步。

**Node 路径**：Hooks 在 Windows 上不再写死 `C:\Program Files\nodejs\node.exe`。
`hooks.json` 的 `commandWindows` 改为调用包内的 `scripts/run-hook.cmd`，由它自己找 node：
先查 PATH 上的 `node.exe`，再依次兜底 `%ProgramFiles%\nodejs`、`%ProgramFiles(x86)%\nodejs`、
`%LOCALAPPDATA%\Programs\nodejs`、`%APPDATA%\nvm`、`%ProgramData%\nvm`。
这样把包拷到任何一台 Windows 机器都不需要改配置；前提是那台机器装了 Node.js（任意 LTS 版本）。
非 Windows 平台走 `command`，直接用 PATH 上的 `node`。

**验证是否装好**：在目标机器上执行

```bash
node "<插件目录>/scripts/hook-session.mjs"   # 应输出一段 JSON，内含证据契约文本
```

或直接看 MiniMax Code 的会话开头是否出现「Groundtruth 证据契约」注入。


## 依赖与边界

- 零 npm 依赖，只用 Node.js 内置模块（`node:fs`、`node:zlib`、`node:path`）。
- Hook 进程失败一律 fail open：脚本异常时不影响正常对话。
- 本插件不做内容安全审查，不替代人工复核，只保证"结论有出处、状态不撒谎"。
