# @manturhub/cli

ManturHub 算子广场的统一 Agent 调用通道。CLI 通过 REST 实时发现和调用全部上线算子，也可浏览配方、安装平台 Skill 和 Agent 套件；新算子上线后无需更新 CLI 即可发现。

## 安装与登录

```bash
npm install -g @manturhub/cli
manturhub login
```

`login` 默认打开浏览器授权，API Key 只保存在 `~/.manturhub/config.json`（权限 `600`）。无浏览器环境可设置 `MANTURHUB_KEY`，或通过 stdin 导入，避免进入 shell history：

```bash
printf '%s' "$YOUR_MANTURHUB_KEY" | manturhub login --key-stdin
```

CLI 默认连接生产站 `https://hub.mantur.ai`，Key 也必须在该生产站创建。`hub.mantur.cn` 是独立测试环境，其 Key 不能用于生产站。

需要 Node.js ≥ 18。也可免安装运行：`npx -y @manturhub/cli <命令>`。

## 快速开始

```bash
# 发现与查看算子无需登录
manturhub ls --cat text
manturhub describe 电商文案生成

# 先查实时价格，再调用
manturhub quote 电商文案生成
manturhub run 电商文案生成 --json '{"product_info":"便携榨汁杯，USB 充电，300ml","scene":"product_title","tone":"lively"}'
```

CLI 会在付费调用前按算子实时 schema 校验未知字段、必填项、类型和枚举，校验失败不会发起 invoke。校验通过后会显示本次预计消耗和计费依据，获得确认才调用；完成后显示实际消耗和退款。批量参数也按整批请求试算。

面向用户的列表、详情、报价、确认和结算统一显示中文算子名，也可直接用中文名调用。英文算子 ID 仅保留在 `--json` 机器输出和内部 API 请求中，供 Agent 与脚本稳定使用。

在 Agent 或脚本等非交互环境中，第一次运行只返回报价和 `quote_id`，不会调用或扣费；Agent 向用户确认后，使用提示中的 `--confirm <quote_id>` 执行。报价 5 分钟内有效且只能使用一次。

## 主要命令

| 命令 | 说明 |
|---|---|
| `manturhub ls [--cat image\|video\|audio\|text\|data] [--json]` | 实时列出上线算子 |
| `manturhub describe <中文算子名> [--json]` | 查看精确入参与异步属性 |
| `manturhub quote <中文算子名> [--json]` | 查询 Java API 返回的实时计费公式 |
| `manturhub run <中文算子名> --json '{}'` | 调用算子；异步任务默认轮询到终态 |
| `manturhub run <中文算子名> --json-file params.json` | 从文件读取参数，适合长提示词和自动化 |
| `manturhub upload <本地文件>` | 流式上传图片、音频或视频并输出公网 URL |
| `manturhub status <poll_url>` | 查询 `run --no-wait` 返回的异步任务 |
| `manturhub balance [--json]` | 查询余额及美元等值（1 馒头 = $0.01 USD） |
| `manturhub skill ls [--json]` / `skill add <slug> [--client codex]` | 浏览和安装业务 Skill；默认自动识别 Agent |
| `manturhub recipe [关键词]` / `recipe get <ID>` | 搜索并查看已验证配方 |
| `manturhub suite ls [--json]` / `suite install <slug>` | 安装多角色 Agent 套件，不复制 API Key |
| `manturhub init` | 给当前项目写入 Agent 使用引导 |

机器消费输出可在支持的查询命令上加 `--json`。进度和提示写入 stderr，JSON 结果写入 stdout。

环境变量：`MANTURHUB_KEY`（优先于配置文件） · `MANTURHUB_BASE`（测试或私有部署覆盖，默认 `https://hub.mantur.ai`）。

ManturHub 算子广场：https://hub.mantur.ai
