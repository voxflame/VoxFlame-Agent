# WAIC 公安检查安全加固清单

> 面向 `voxember.com` 展会 / 公安检查留档。最后实测时间：2026-07-08 14:00 左右。本文不存放密钥。

## 1. 当前结论

### 已完成

- Web/API/agent 健康口的本机暴露面已收紧：`3000`、`3001`、`8081` 均只监听 `127.0.0.1`。
- 公网 Web 入口统一由 Caddy 的 `80/443` 提供反代。
- 线上响应头已补齐安全头：`Content-Security-Policy`、`Permissions-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`。
- `X-Powered-By: Next.js / Express` 已从公网响应中消失。
- 后端 CORS 已从 `*` 收紧为 Origin 白名单，`/api/rtc/health` 实测响应为 `Vary: Origin`。
- DNSPod 已存在根域 CAA：`0 issue "letsencrypt.org"`。
- EdgeOne 站点、根域加速域名、回源、WebSocket、HTTPS 强跳、HSTS、CC/DDoS、WAF 托管规则拦截已配置。

### 仍需完成

- 权威 NS 仍是 DNSPod：`eleven.dnspod.net`、`rich.dnspod.net`。因此公网 DNS 现在仍解析到源站 `111.230.35.89`，EdgeOne/WAF 还没有真正接管线上流量。
- EdgeOne HTTPS 证书仍待 NS 验证后申请 / 部署。当前 API 返回域名还在 pending/init，需 NS 生效后再启用 EdgeOne 证书。
- 源站云安全组 / 防火墙仍需定位实例并限制 `80/443/7880/7881/22` 来源。当前 CAM 子账号缺少腾讯云 Domain / Lighthouse 权限，无法完整代改注册商 NS 与轻量服务器防火墙。
- EdgeOne Bot 防护当前显示为 off；个人版套餐下不要把 Bot 防护写成已完成证据。

## 2. 服务器侧实测状态

实测命令：

```bash
sudo ss -ltnp
sudo docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
curl -I --noproxy '*' https://voxember.com
curl -I --noproxy '*' https://voxember.com/api/rtc/health
```

关键结果：

| 端口 | 当前监听 | 检查结论 |
| --- | --- | --- |
| 80 | `*:80` | 公网 HTTP 入口，Caddy 管理 |
| 443 | `*:443` | 公网 HTTPS 入口，Caddy 管理 |
| 3000 | `127.0.0.1:3000` | 已禁止公网直连 |
| 3001 | `127.0.0.1:3001` | 已禁止公网直连 |
| 8081 | `127.0.0.1:8081` | livekit_agent 健康口已禁止公网直连 |
| 7880 | `*:7880` | LiveKit 信令端口仍公网监听，后续应放到 EdgeOne / Caddy / 安全组策略内 |
| 7881 | `*:7881` | LiveKit TCP RTC 端口仍公网监听，需按现场 RTC 最小放行 |
| 22 | `*:22` | SSH 管理口，应在云防火墙限制固定办公 IP |

容器状态：

```text
voxflame-frontend  127.0.0.1:3000->3000/tcp  healthy
voxflame-backend   127.0.0.1:3001->3001/tcp  healthy
voxflame-livekit-agent                         Up
voxflame-livekit-server                        Up
voxflame-caddy                                 Up
```

线上响应头抽样：

```text
HTTP/2 200
content-security-policy: ...
permissions-policy: ...
strict-transport-security: max-age=31536000; includeSubDomains; preload
via: 1.1 Caddy
x-content-type-options: nosniff
x-frame-options: DENY
```

未再看到：

```text
X-Powered-By: Next.js
X-Powered-By: Express
```

## 3. EdgeOne / WAF 当前配置

EdgeOne 站点：

```text
ZoneName: voxember.com
ZoneId: zone-3sacn5q6g224
Type: full / NS 接入
PlanType: plan-personal
Status: pending
ActiveStatus: inactive
目标 NS: ns1.qeodns.com, ns2.qeodns.com
当前 NS: eleven.dnspod.net, rich.dnspod.net
```

加速域名：

```text
DomainName: voxember.com
DomainId: edge-3sacy37kmnbh
CNAME: voxember.com.eo.dnse2.com
DomainStatus: init
IdentificationStatus: pending
Origin: 111.230.35.89
OriginProtocol: HTTPS
Origin Host/Header: voxember.com
HTTP origin port: 80
HTTPS origin port: 443
```

EdgeOne DNS 记录：

| 类型 | 内容 | 状态 | 说明 |
| --- | --- | --- | --- |
| CNAME | `voxember.com.eo.dnse2.com` | enable | 根域 EdgeOne 加速记录 |
| A | `111.230.35.89` | disable | 已停用，避免切 NS 后继续直连源站 |
| CAA | `0 issue "letsencrypt.org"` | disable | CNAME 与同名 CAA 冲突，EdgeOne 侧暂不启用 |

EdgeOne 安全策略：

```text
WebSwitch: on
WAF: on
WAF Mode: block
ManagedRules.Enabled: on
ManagedRules.DetectionOnly: off
ManagedRuleGroups wafgroup-free Action: Deny
CC: on
DDoS: on
ForceRedirectHTTPS: on
WebSocket: on
HSTS: on
Bot: off
```

## 4. 需要您在腾讯云控制台完成的动作

### 4.1 切换权威 NS

当前 CAM 子账号没有腾讯云 Domain 权限，API 无法代改注册商 NS。请在腾讯云控制台手动改：

```text
腾讯云控制台 -> 域名注册 / 我的域名 -> voxember.com -> DNS 服务器 / 修改 DNS
```

把 DNS 服务器从：

```text
eleven.dnspod.net
rich.dnspod.net
```

改成：

```text
ns1.qeodns.com
ns2.qeodns.com
```

提交后等待 5-30 分钟，最长可能数小时。验证：

```bash
dig +short NS voxember.com
dig +short voxember.com A
curl -I --noproxy '*' https://voxember.com
```

合格结果：

- `NS` 返回 `ns1.qeodns.com`、`ns2.qeodns.com`。
- `A` 不再直接稳定返回 `111.230.35.89`。
- `curl` 响应头出现 EdgeOne 相关痕迹。

### 4.2 NS 生效后申请 EdgeOne HTTPS 证书

NS 生效后，在 EdgeOne 控制台进入：

```text
EdgeOne -> 站点 voxember.com -> 域名服务 / 加速域名 -> voxember.com -> HTTPS
```

选择 EdgeOne 免费证书 / 自动托管证书，开启 HTTPS。验证：

```bash
curl -I --noproxy '*' https://voxember.com
```

### 4.3 源站防火墙 / 安全组

NS 与 EdgeOne HTTPS 正常后，再封源站，避免 WAF 穿透：

| 端口 | 建议来源 | 说明 |
| --- | --- | --- |
| 22 | 固定办公 IP | SSH 管理入口 |
| 80 | EdgeOne 回源 IP | HTTP 回源 / 证书验证入口 |
| 443 | EdgeOne 回源 IP | HTTPS 回源入口 |
| 3000 | 禁止公网 | Next.js 已只监听本机 |
| 3001 | 禁止公网 | Express API 已只监听本机 |
| 8081 | 禁止公网 | livekit_agent 健康口已只监听本机 |
| 7880 | 按 LiveKit 实测最小放行 | 优先经 Caddy/EdgeOne WebSocket，不裸露给任意来源 |
| 7881 | 按 LiveKit 实测最小放行 | TCP RTC 端口，按现场需要保留或限制 |

若源站是轻量应用服务器 Lighthouse，请给临时 CAM 子账号补 Lighthouse 只读 + 防火墙规则修改权限，我再继续定位实例并代改。

## 5. DNSSEC / CAA 说明

- DNSPod 当前已有 CAA，验证命令：`dig +short CAA voxember.com`，结果应包含 `0 issue "letsencrypt.org"`。
- 切到 EdgeOne NS 后，根域加速使用 CNAME，EdgeOne 不允许同名 CNAME 与 CAA 同时启用；因此 EdgeOne 侧根域 CAA 目前被暂停。
- DNSSEC 当前未开启。NS 切到 EdgeOne 后，应优先在 EdgeOne / 注册商可用路径里开启 DNSSEC，再留截图；不要在 NS 切换过程中同时改 DNSSEC，避免解析故障难排查。

## 6. WAIC / 公安留档截图清单

- `sudo ss -ltnp`：显示 `3000/3001/8081` 仅监听 `127.0.0.1`。
- `curl -I https://voxember.com`：显示安全响应头且无 `X-Powered-By`。
- EdgeOne 站点 `voxember.com` 页面：显示套餐、站点、目标 NS。
- EdgeOne 加速域名页面：显示源站 `111.230.35.89`、HTTPS 回源、回源 Host `voxember.com`。
- EdgeOne Web 安全页面：显示 WAF 托管规则为拦截 / Deny，CC/DDoS 开启。
- DNS / 域名注册页面：显示 NS 已切到 `ns1.qeodns.com`、`ns2.qeodns.com`。
- 云服务器 / 轻量服务器防火墙页面：显示源站端口按最小来源放行。
- 首页底部备案截图：`上海生声不息科技有限公司`、`沪ICP备2026020229号`。

