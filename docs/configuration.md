# 配置

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SPARK_PORT` | 开发 `7789` / 生产 `7788` | HTTP 与 MCP 共用端口 |
| `SPARK_DATA_DIR` | 开发：`apps/server/data`；`pnpm start`：`~/.spark` | 配置、日志、运行时记录 |
| `SPARK_WEB_DIST` | `apps/web/dist` | 生产模式托管的前端目录 |

开发脚本里已经写死 `SPARK_PORT=7789`，页面由 Vite（5173）代理到该端口。日常使用 `pnpm start` 走 7788。

## 数据目录

`pnpm dev` 固定写在仓库的 `apps/server/data`（脚本里设置了 `SPARK_DATA_DIR=./data`），方便本地调试，不会迁走。

`pnpm start` 使用 `$HOME/.spark`。如果项目 `data` 里已有 `projects.json`，且 `~/.spark` 还没有，首次启动会复制过去；之后两边各自读写。

```
~/.spark/
├─ projects.json          # 项目 + 分组
├─ settings.json          # 全局设置
├─ logs/spark.log.jsonl   # Spark 自身运行日志
└─ runtime/               # 终端进程记录与磁盘日志（本机专用，不要当配置迁移）
```

写入采用「临时文件 + rename」。`projects.json` / `settings.json` 损坏时会备份为 `*.corrupt-<时间戳>`，并以空配置继续。

直接拷贝整个目录即可迁移配置。`runtime/` 含 PID 与本机日志，换机器后没有意义。

## 设置页

| 项 | 说明 |
| --- | --- |
| 退出 Spark 时停止所有项目 | 默认关闭：项目继续在后台跑，下次启动恢复管理 |
| Shell 启动方式 | `login`（`zsh -ilc`）/ `non-login`（`zsh -lc`）/ `direct`（`/bin/sh -c`） |
| 日志最大行数 | 页面环形缓冲，默认 5000 |
| 自动重启次数上限 | 项目开启崩溃重启后的上限，默认 3 |

Shell 方式影响 PATH、nvm、pyenv、conda 是否与终端一致。`.zshrc` 过重导致启动慢时，可改成非登录 shell 或直接 spawn。
