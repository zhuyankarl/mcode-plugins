# 插件上架材料工作台（submission-workbench）

一个 Mini App：填写插件清单与上架信息，逐项核对名称、版本、必填字段与内容一致性，
一键生成可审核的**上架材料包**，并标出还缺哪些必填项。

## 它做什么

页面上分四块：

1. **上架信息** —— 粘贴 `.minimax-plugin/plugin.json` 全文，填期望市场名称、目标分类、
   简介、说明文档（会写进包的 README.md）、最多 3 条示例 query。
2. **目标市场要求** —— 上架新 Plugin 还是更新已有 Plugin（更新时原 Plugin 名必须不变、
   并填上次提交版本）、提交邮箱、提交飞书账号、目标区域（CN/US）、启用端（桌面端/云端）。
   区域与启用端是**两个独立维度**，由 Marketplace catalog 管理，不写进 `plugin.json`。
3. **素材** —— 按角色上传：图标（对应 manifest 里的 `icon` 路径）、截图、Skill/MCP/App 文件。
4. **结果区** —— 「检查结果」列出缺失项与内容冲突，「上架预览」给出市场卡片预览，
   「提交通道与权限」显示探测到的提交通道，「上架材料包」可下载打包好的 ZIP。

## 怎么用

装好后在 MiniMax Code 里打开这个 Mini App，页面地址是 `/dashboard`。
也可以直接对 Agent 说「检查我的插件清单能不能上架」「生成插件上架材料包」。

## 运行环境

- 需要 **Node.js**（任意 LTS 版本），因为 Node 载荷是纯 Node 进程。
- **零第三方依赖**：只用 Node 内置模块（`node:http`、`node:fs`、`node:zlib`、`node:crypto` 等），
  宿主不装依赖、不跑构建，所以包体可以直接运行。
- 页面是原生 HTML/CSS/JS，无构建步骤。

## 权限与数据

- `miniapp.json` 只声明了页面与 Node 两份载荷，未申请 `hostConnectorAccess`、
  `agentAccess`、`deviceAccess` 等额外权限。
- 草稿与素材存在宿主为该插件提供的可写数据目录里，不写插件包本身。

## 安装

见仓库根目录的 [README](../../README.md)。最省事的一条：

```powershell
git clone https://github.com/zhuyankarl/mcode-plugins.git
cd mcode-plugins
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

装完重启 MiniMax Code，在插件市场确认「插件上架材料工作台」已启用。
也可以走图形界面：插件市场 →「创建」→ Mini App →「从 Git 仓库导入」，
填 https://github.com/zhuyankarl/mcode-plugins/tree/main/plugins/submission-workbench 。

## 自测

包内附带自测脚本，在插件目录下执行：

```bash
node miniapp/node/selftest.mjs
```

## 许可证

MIT，见仓库根目录 [LICENSE](../../LICENSE)。
