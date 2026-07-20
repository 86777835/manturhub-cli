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

需要 Node.js ≥ 18。也可免安装运行：`npx -y @manturhub/cli <命令>`。

## 快速开始

```bash
# 发现与查看算子无需登录
manturhub ls --cat text
manturhub describe op.text.commerce-copy

# 先查实时价格，再调用
manturhub quote op.text.commerce-copy
manturhub run op.text.commerce-copy --json '{"product_info":"便携榨汁杯，USB 充电，300ml","scene":"product_title","tone":"lively"}'
```

CLI 会在付费调用前按算子实时 schema 校验未知字段、必填项、类型和枚举，校验失败不会发起 invoke。

## 主要命令

| 命令 | 说明 |
|---|---|
| `manturhub ls [--cat image\|video\|audio\|text\|data] [--json]` | 实时列出上线算子 |
| `manturhub describe <算子ID> [--json]` | 查看精确入参与异步属性 |
| `manturhub quote <算子ID> [--json]` | 查询 Java API 返回的实时计费公式 |
| `manturhub run <算子ID> --json '{}'` | 调用算子；异步任务默认轮询到终态 |
| `manturhub run <算子ID> --json-file params.json` | 从文件读取参数，适合长提示词和自动化 |
| `manturhub upload <本地文件>` | 流式上传图片、音频或视频并输出公网 URL |
| `manturhub status <poll_url>` | 查询 `run --no-wait` 返回的异步任务 |
| `manturhub balance [--json]` | 查询余额及美元等值（1 馒头 = $0.01 USD） |
| `manturhub skill ls [--json]` / `skill add <slug> --client codex` | 浏览和安装业务 Skill |
| `manturhub recipe [关键词]` / `recipe get <ID>` | 搜索并查看已验证配方 |
| `manturhub suite ls [--json]` / `suite install <slug>` | 安装多角色 Agent 套件，不复制 API Key |
| `manturhub init` | 给当前项目写入 Agent 使用引导 |

机器消费输出可在支持的查询命令上加 `--json`。进度和提示写入 stderr，JSON 结果写入 stdout。

环境变量：`MANTURHUB_KEY`（优先于配置文件） · `MANTURHUB_BASE`（测试或私有部署覆盖，默认 `https://hub.mantur.ai`）。

ManturHub 算子广场：https://hub.mantur.ai
