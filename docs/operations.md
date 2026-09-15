# subHUB 运维手册

## 生产边界

subHUB 按单 Owner、单 Web 实例、单 Gateway 实例设计。Web 和 Gateway 的 Compose 端口均绑定 127.0.0.1，公网流量必须先经过同机 HTTPS 反向代理。Gateway 的 Bearer Token 只在容器私有网络中传递。

生产环境必须配置：

- SUBHUB_WEB_PASSWORD：独立的高熵 Owner 密码。
- SUBHUB_WEB_SESSION_SECRET：至少 32 字节的随机会话签名 Secret。
- SUBHUB_WEB_INTERNAL_TOKEN：与密码、会话 Secret 均不同的随机内部 Token。
- SUBHUB_PUBLIC_ORIGIN：精确 HTTPS Origin，例如 https://subhub.example.com，不含 /code/subhub。
- NEXT_PUBLIC_BASE_PATH：反向代理使用的路径前缀；根路径部署时留空。

SUBHUB_TRUST_PROXY_HEADERS 默认保持 false，此时所有请求共享 Owner 限速桶，客户端无法通过伪造 IP 头绕过。只有 Web 端口无法被直连、且反向代理明确覆盖 CF-Connecting-IP / X-Real-IP / X-Forwarded-For 时才启用。

## 健康、停止与日志

- Gateway /health 返回服务状态、目录数量和数据库修订号。
- Web /api/health 会实际探测 Gateway，任一层不可用即返回 503。
- Compose 为两项服务配置了健康检查；Web 等待 Gateway 健康后启动。
- Gateway 捕获 SIGTERM / SIGINT，停止接受连接并在关闭数据库前等待 HTTP Server 完成。
- Gateway 日志只记录时间、requestId、方法、路径、状态、耗时和受控错误码，不记录请求体或认证头。
- 设置页可查看最近审计记录；审计摘要完全由服务端生成。

## 业务 JSON

业务 JSON 由 Gateway 从同一数据库修订版生成。恢复流程分成 preview 和 commit，文件内容或数据库修订发生变化后，旧的恢复标识立即失效。该文件不等于数据库备份，不包含审计、登录限速或数据库 migration 元数据。

## SQLite 备份

在线备份：

    docker compose exec subhub-gateway node scripts/backup.mjs /backups

脚本使用 node:sqlite 的在线 backup()，兼容 WAL；完成后在独立连接中运行 integrity_check 和 foreign_key_check，再按 SUBHUB_BACKUP_RETENTION 清理旧备份。

恢复只能在 Gateway 停止后执行：

    docker compose stop subhub subhub-gateway
    docker compose run --rm subhub-gateway node scripts/restore.mjs /backups/<backup-file>.sqlite
    docker compose up -d

恢复工具在写入前后各做一次完整性检查，并把当前数据库保存为 .before-restore-<timestamp>。恢复后应检查：

    docker compose ps
    docker compose logs --tail=100 subhub-gateway

至少定期把 /backups 中的文件复制到另一台受控设备或加密存储，并按季度在隔离实例做恢复演练。

## 发布验收

    pnpm install --frozen-lockfile
    pnpm test
    pnpm lint
    docker compose config
    docker compose build
    docker compose up -d

随后验证根路径或配置的 Base Path、登录/退出、保存后刷新、双窗口 409、业务 JSON 导出恢复、SQLite 备份恢复、容器重建后的数据持久性，以及 Web/Gateway 不可从非预期网络接口访问。
