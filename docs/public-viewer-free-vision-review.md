# PR #15 后：Public Viewer、账号权限和免费视觉容灾

基线 master b6cb72b6bb4922a7b515530f19f04144a6ffeda7。沿用现有 GitHub / Vercel / Supabase，WBS 和工程量解析架构保持不变。

## 公开查看

部署后入口 `/view`；`/viewer.html` 为等效入口。GET `/api/public-dashboard` 只输出已发布快照；不会读取/转发完整业务 payload。Editor 点击“发布公开看板”前必须确认施工内容、人员数和 WBS 数据可以公开。照片须 `publicApproved=true`、人工复核、明确关联日报、有效施工场景且未忽略/未确认为 Logo。`/api/public-photo?id=...` 检查已发布名单及当前审批状态，代理图片字节，不返回签名 Storage URL、对象路径、原始 PDF 或关联原文。快照默认为空。业务表及快照均不向 anon 授权；私有桶保持私有。

后端需要 `SUPABASE_SERVICE_ROLE_KEY`（仅服务端，禁止进入客户端配置）。缺少密钥或 migration 时失败关闭，不回退到直接公开业务表。

## Reader / Editor / 管理员

复用现有邮箱验证、设置至少 12 位密码及后续邮箱密码登录。OTP 始终 `shouldCreateUser:false`。普通用户不能修改 project_members。

增量 migration 补齐日报、图片、Audit、私有 Storage 的 Reader 读取及 Editor 写入策略；原 owner ALL 策略也受 restrictive Editor 写边界限制。Audit 对客户端仅追加、禁止更新删除；原始文件不允许客户端删除。工程量、物流、Crosswalk 现有 restrictive member boundary 与 permissive Editor 写策略保持原样，不存在 Reader ALL 放权。

新 `is_admin` 只在已有 Khayrat editor 成员匹配原管理员已存在的 auth.users 邮箱时初始化。管理员 UI 可预建邮箱或修改已加入项目的 UUID 的 reader/editor 角色，不允许 UI 授予 is_admin，也不自动发送邮件。新账号通过现有登录页发送验证邮件后设置密码。另需在 Supabase Auth 后台确认“Allow new users to sign up”关闭；前端不包含 signUp，拒绝自动注册不能代替 Auth 服务配置。

## 视觉链与隐私（官方资料核验：2026-10-07）

1. Primary Groq / qwen/qwen3.8-27b（保持现配置）
2. Backup 1 Google Gemini / gemini-3.8-flash
3. Backup 2 Google Gemini / gemini-3.5-flash-lite
4. Backup 3 Google Gemini / gemini-3.7-flash

三个备用均支持图片输入、JSON/Structured Output，当前官方 pricing 明确有免费输入/输出层。Gemini 2.5 模型对新项目访问受限，未加入。备用共用 Google 服务，无法抵御 Google 整个平台中断；不声称三家独立服务商。

Groq 当前免费限额表：30 RPM / 1,000 RPD / 8,000 TPM / 200,000 TPD；客户端继续采用每张约 61 秒的保守节奏。额度以账户控制台与响应限流头为准。Gemini 免费配额因项目/模型而异，以 AI Studio 当前 limits 为准；不硬编码旧的 15 RPM / 1,500 RPD。

Gemini 免费条款允许 API 应用使用，但免费输入/输出可能用于产品改进，也可能被人工审阅，明确禁止提交敏感、保密或个人信息。商业项目不自动豁免这些条件。只适用于经确认可以外发的非保密资料；如工程照片或原文属于保密资料，不能启用 Gemini 免费备用。

开启备用须服务端配置 GEMINI_API_KEY，并确认 GEMINI_FREE_TIER_CONFIRMED、GEMINI_BILLING_DISABLED_CONFIRMED、GEMINI_NONCONFIDENTIAL_USE_CONFIRMED 均为 true；必须使用未启用 Billing 的 Google 项目。代码不会创建付费账户或切换付费模型，但软件不能独立证明服务商账户日后未被管理员开启 Billing；上线前与账户变更后须核验。授权绑定完整 provider/model 范围及隐私版本，新增接收方必须重新授权。

429、5xx、超时、明确模型下线错误可依顺序切换；400/401/403、业务权限、授权失败、无效图片或不合格结构化输出立即停止。每张成功即停止后续链。vision_runs 存储最终结果及逐次 Provider/Model、时间、错误、Usage；成功缓存及并发占用防止重复调用。既有 successful automaticAnalysis 可复用。失败不伪造 token 消耗；服务商无 usage 时记 null。所有结果需人工复核。

全部免费服务失效提示：“所有免费视觉服务当前均不可用，请稍后重试。未产生付费调用。”

资料：https://console.groq.com/docs/vision 、https://console.groq.com/docs/rate-limits 、https://ai.google.dev/gemini-api/docs/pricing 、https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash 、https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite 、https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash 、https://ai.google.dev/gemini-api/docs/rate-limits 、https://ai.google.dev/gemini-api/terms 。OpenRouter 免费方案调研过，但下游服务商范围与授权更复杂，本次未引入。

## Logo 与最新车间

新导入排除须：小面积页眉/页脚、跨页像素内容一致、背景/色彩熵符合 Logo 特征；删除了旧版“文件很小、重复三页即可排除”的规则。缺少像素或特征不确定时保留。真实照片固定版式位置不是删除依据。

既有 ignored 仅按明确 legacy-decorative-review 恢复，不把 ignored 当 Logo 证明。人工在图片复核中单独确认 logoConfirmed 后，逐张清理接口先保存完整 Audit，再删 Evidence 文件和记录；原始 PDF 保留。没有自动批量清理。

车间采用 NFKC、空格归一和明确别名表；每个车间最新日期合并所有工序/活动。日常 Dashboard 计划/实际 KPI 仅来自 WBS，不再用旧日报百分比补缺。

## Production 只读核查结果

80 日报、95 图片、8 Audit、532 工程量、1 工程量导入批次、1 成员；equipment_shipments=0、crosswalk_mappings=0 为待录入。图片 44 张 visionEnabled、2 张 manualReviewed、65 张具有关联车间、65 张有布局坐标；ignored=true 当前为 0（历史误标已恢复，不重复声称本 PR 恢复了这些图片）。Storage khayrat-reports 为 private。

已有真实验证：工程量上传与 22P02 修复、真实 Excel WBS 计算/版本/Hash 回归、已有 Groq 真实结果。尚待真实验收：新的 Public 发布与照片代理、Reader/Editor 实际账号、新 Gemini key 的模型可达/免费配额/JSON 测试、历史 Logo 逐张检查、最新车间别名业务确认。To Be Verified 的工程量基准/实际总量差异保留为业务复核，未自动修正。

## 上线顺序

先审查并应用增量 migration（本次仅本地 PostgreSQL 验证，未自动应用到生产）；确认管理员仍为 Editor 且 is_admin=true；确认 Auth signup 关闭；服务端配置 SUPABASE_SERVICE_ROLE_KEY；合并 PR 触发既有 Vercel 项目部署；创建测试 Reader 和 Editor 验收 RLS；审核公开内容后首次发布。Gemini 可保持禁用，待免费/非保密输入条件与 key 满足后启用并重新授权。

没有清空、覆盖或删除现有业务数据。历史 Logo 的实际删除尚未执行；公开快照尚未发布。

## 验证边界

本地 Unit/PostgreSQL 127/127 与生产构建通过，Public Viewer / Reader / WBS 8/8 浏览器测试通过。真实 Excel 从用户提供文件恢复，Git blob Hash 与仓库完全一致。GitHub 连接器不支持读取二进制 PDF，因此本地 PDF E2E 使用另行生成的替代样本作补充检查；不把此样本写入远端，不把它当作原测试文件验收。完整 E2E 最终以 GitHub CI 使用仓库原始 synthetic-reports.pdf 的结果为准。
