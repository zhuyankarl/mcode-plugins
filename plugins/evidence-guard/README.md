# Evidence Guard 证据守门

给**高幻觉倾向模型**（如 MiniMax M3.1-Flash，AA-Omniscience 上幻觉率约 92.8%）装一套
**可核查**的取证纪律：每条结论都标出是「已验证」还是「未验证」，数值必须回源到真实表格的
某一个单元格，读不到就明说查无此值并给出核实路径。

这个包是**纯 Skill**，没有 Hook、不联网、不收集任何数据，所有逻辑都在你的本地会话里跑。

---

## 为什么需要它

M3.1-Flash 的问题不是"不会"，而是**几乎从不拒答**：56% 的问题答对，但因为每题都硬答，
基准把"答了但错"也计为幻觉，得到 ~92.8% 的幻觉率。这靠更强的检索或更高的推理预算都补不上，
只能靠**结构化的弃权位 + 强制出处 + 确定性校验**来压。

## 两个 Skill

| Skill | 管什么 |
| --- | --- |
| `evidence-contract` | claim-to-proof 循环：每个结论先说清"什么能证明它"，再跑最小验证，然后按【已验证】/【未验证】/【无法验证】标注。禁编造路径、字段名、函数签名。 |
| `number-grounding` | 数值回源协议：每个数字必须落到 `表名!Sheet!单元格`，附原始读数；表读不到就说"无法验证"并给出该查哪张表。 |

## 取数脚本

包内自带一个**零依赖**的表格读取器 `scripts/probe-table.mjs`，只用 Node.js 内置模块
（`node:fs` / `node:zlib` / `node:path`）。先确认 Node.js 可用：`node --version`。

```bash
# 1. 找到真实存在的表（不要凭记忆猜表名）
node "<plugin-dir>/scripts/probe-table.mjs" find 产量明细 --root D:/project/data

# 2. 列出工作表
node "<plugin-dir>/scripts/probe-table.mjs" sheets "<表路径>.xlsx"

# 3. 按行导出，带坐标
node "<plugin-dir>/scripts/probe-table.mjs" dump "<表路径>.xlsx" --sheet Sheet1 --max-rows 60

# 4. 读一个确定的单元格
node "<plugin-dir>/scripts/probe-table.mjs" cell "<表路径>.xlsx" Sheet1 C7

# 5. 在所有单元格里找关键词
node "<plugin-dir>/scripts/probe-table.mjs" search "<表路径>.xlsx" 产品甲
```

`<plugin-dir>` 是本插件的安装目录（插件管理里能看到）。如果运行时注入了
`${PLUGIN_ROOT}`，直接用它替换即可。

每一行输出都自带坐标（`表名!Sheet!单元格 = 值`），可以直接原样引用。

### CSV

`.csv` 被当作**真正的多列表格**，不是一列文本。列坐标按 A1 规则给出，值在第几列就取第几列：

```bash
# 产出表.csv 的第 3 列第 2 行
node "<plugin-dir>/scripts/probe-table.mjs" cell "<表路径>.csv" C2
# 关键词搜索会扫全部列
node "<plugin-dir>/scripts/probe-table.mjs" search "<表路径>.csv" 产品甲
```

CSV 按 RFC 4180 解析：引号内的逗号和换行是字面量，`""` 表示一个引号，UTF-8 BOM 会被去掉。
分隔符默认是逗号；文件里没有逗号时会自动识别分号或制表符，也可以用
`--delimiter ";"` 显式指定。

### 支持范围

| 格式 | 支持情况 |
| --- | --- |
| `.xlsx` | 支持。包括 zip64 归档和用 **data descriptor**（通用标志位 0x08）写出的流式归档 —— 压缩包中央目录里的尺寸才是权威来源，本地文件头在流式写入时是 0。 |
| `.csv` | 支持，多列 + 引号 + 嵌入换行。 |
| `.xls`（BIFF8 旧格式） | **不支持**，脚本会明确报错。请先另存为 `.xlsx`，或改用 `xlsx` Skill，并在回复里说明走了哪条路。 |

读不到就报"查无此值"，不会拿估计值糊过去 —— 这是这个包存在的全部意义。

## 自测

包内带回归测试，覆盖多列 CSV、引号字段、UTF-8 BOM、data descriptor 归档、zip64 与旧版
`.xls` 的报错路径：

```bash
node --test "<plugin-dir>/tests/probe-table.test.mjs"
```

## 这个版本**不包含**什么

- **没有 Hook。** 本包是纯 Skill 形态，不会自动注入上下文、不会在收尾时拦截你的回复。
  上面两条纪律要靠 agent 自觉执行。
- **没有联网能力。** 不发请求、不上报、不写用户目录，只读你明确指名的文件。
- **没有依赖安装。** `package.json`、安装期脚本、`node_modules` 都不存在。

## 提交说明（重新上架记录）

本包曾于 2026-11-16 首次投稿（`submission_id` = `PLUGIN-202611160276`），**审核未通过并发布失败**，
原因两条，均已在本版修复：

1. **CSV 只取每行第一列。** 旧版 `probe-table.mjs` 读 CSV 时只取 `cells[0]`，其余列被丢弃，
   于是 `cell` / `search` 对真实存在的值一律报「查无此值」，与当时 README 宣称支持 `.csv` 不符。
   现按 RFC 4180 解析全部列，每个非空字段都带真实 A1 坐标（值在第几列就取第几列）。
2. **data descriptor 归档解析失败。** 旧版 `lib/xlsx.mjs` 用 zip **本地文件头**的尺寸解压；
   而用通用标志位 0x08 流式写出的归档，该处存的是 0，每个条目都被读成空，整个工作簿打不开。
   现以**中央目录**的尺寸为权威，并补上 zip64 与 data descriptor 回退路径。

修复后新增 `tests/probe-table.test.mjs`（11 条回归测试）：多列 CSV、引号字段、嵌入换行、UTF-8 BOM、
data descriptor 归档、常规归档、`.xls` 报错路径，全部覆盖上述两个缺陷。

源码与提交历史：<https://github.com/zhuyankarl/mcode-plugins> ，本包对应 `plugins/evidence-guard/`。

## 许可

MIT，见 [LICENSE](LICENSE)。
