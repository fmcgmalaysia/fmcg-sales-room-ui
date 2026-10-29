# Loaded 单次实物出库候选

本轮目标是成功 Loaded 保存形成唯一实物出库，开单与 Dispatch 引用同一装货及来源。借补责任、Support 数量交接、月结及历史归档仍按专题交接分阶段实施；本轮没有启用另一库存候选、迁移或删除 CMS。

## 唯一权威与保留行为

新增 physicalOutflow 只投射原有装货保存事实，没有第二份可修改库存余额。Warehouse 与 Packing 仍用原公司保存锁、请求身份及恢复回执；对应记录保存累计 Loaded 与冻结来源。累计80到100只追加20，重复回执不会重复出库。来源沿原显式分配，分批来源沿原 batch entitlement，不在开票时重新猜测。

Stock Position、Stock Card、分配下限、Warehouse 可装量、Packing 剩余量及 Purchase 实物来源数量共用该投射。发票与 Dispatch 的付款、应收、审核、商业完成条件保留原义，它们不再产生实物扣量。客户发票完成合同仍要求先有发票；独立 loadedQty 来自同一实物权威，不把未开票装货伪造为已完成发票。

历史不可变 Dispatch 的明确来源承接到同一投射。旧 Loaded 与历史 Dispatch 仅在唯一 WHOLE 身份、客户及总量精确对应时承接，不能取两边 max 或无条件相加。未能对应的旧 Loaded 显式阻止使用，需核对来源。没有为新 Dispatch 留下独立扣量路径；新发票必须引用已确认 Loaded。

已成功出库的数量不能通过普通装货下调自动加回库存；主管纠错与真实退货的详细合同尚未定义。原照片、有效期、公司隔离、权限、FX/成本/发票快照、付款和请求重试保持原机制。普通财务完成与归档仍可能等待商业 Dispatch 确认，不能将其误报为第二次库存扣减。

## 衔接修正

- 完成清单的已出库数量由同一来源事实保护；仍在进行的 Packing 清单保留原严格占用保护。
- 上一柜已经开票的完成清单不会阻止下一柜；新发票只承接它引用的完成清单或已被有效发票完整承接的清单。
- Warehouse 分批可装量按真实装货身份扣减；第二批先装不会扣走第一批的来源与可装量。
- Packing 不将从未执行过的旧 Sales 分批计划差异当成已存在的 Warehouse 执行错误。任何真实保存过的过期准备、孤立记录及实装仍阻止静默改派。
- 浏览器 Packing 模型由同一后台纯模型机械生成，防止浏览器再次减去已扣 Loaded 的占用。

正式 Packing 旧入口已有两项故障：Support 在同一 iframe 内导航后 document.referrer 指向旧子页，而实际父页仍为 Wix；Warehouse 限定版本表未包含当前 Wix 的版本。候选使用实际父层 origin 并保持原主机白名单、event.source、员工身份和部门校验；只增加已经具备桥接程序的当前入口版本。未放宽认证或数据权限。

## 证据与验收边界

十四个保存中的 Wix 后台模块与 080d357 原件完成可见编辑器全文比较并保留哈希，见 EDITOR_COMPARISON.json。新模块及十三个既有模块的54个独立补丁可由 prepare-wix-patches.cjs 重建，应用前后都要全文复核。恢复原件在根专题 live-readback-20261028。保存中编辑器一致不等于独立读取了发布中的后端版本。

隔离合同的14项数量观察、18项保护断言通过；新增12项覆盖累计、去重、冻结来源、分批、公司并发锁、历史精确承接、未知旧来源阻断。扩展195项中194通过。唯一失败是原有 Sales/Buyer 文案测试期待“等待补货”，当前未改页面显示 Awaiting balance；该失败在前两轮已有记录，本轮不改测试或客户页来隐藏它。

真实浏览器界面配合实际后台工厂、隔离内存资料完成：Support 原 iframe 内进入 Packing、创建100并发送；Warehouse 当前正式入口版本打开同一清单、装80并完成；在手150变70，Support 剩余20可见，开票和 Dispatch 后仍70。浏览器错误0、真实外部请求0、生产交易写入0。结果见 PACKING_UI.json。

并发锁竞争可能仍返回原有 duplicate/processing 提示，原失败请求可以重试并只完成一次。此轮未重写所有部门共用的 journal；更友善的提示及跨进程锁恢复应另行最小处理。

静态包维持99项边界，12项为预期变化（含构建与缓存标记），87项精确保留；后台及私有原件不进入 Pages。

上线前只读可见 Warehouse：NCT 四条 Delivery 记录 Loaded 均0，GHR 无 Delivery 记录。Packing 清单及发布后数据读取还须现场确认。没有在生产编造收货、装货或发票来验收。

## 发布记录

- 代码：已提交并同步 `39bf0674694069cab05a511d414cea1e24a1cbd1`，实施 PR233 保持 draft，未合并 main。
- GitHub Pages：run `40720416125` 成功，build `20261028-stock-loaded-v1`；99/99 资源精确匹配。临时分支放行已撤销，原7条规则精确恢复。见 PAGES_VERIFICATION.json。
- Wix Studio：新增模块及13个最小修改模块全部完成全文匹配，14/14 哈希与候选源一致；重新载入后又确认 physicalOutflow 与 warehousePreparation 保存内容。见 WIX_SYNC.json 和 WIX_SOURCE_HASH_CHECK.json。编辑器恢复后执行发布，已可见本轮明确的 Congratulations 对话框及“This site is published and live online.”，回执见 RELEASE_STATUS.json。
- 正式页：本轮发布后刷新并进入 Warehouse 的收货、Delivery/Packing、Stock Control，能读取真实资料：7 UP 在手95、已分配95、自由0，来源50与45。Support 刷新曾因 Wix React 静态资源连接重置及 Scheduler 未定义而空白，普通重载后客户资料与新版 Packing 入口恢复。然而同一商品 Packing Ready 从发布前95变为0，待发100、占用0未变，故正式验收失败。本轮不能声称发布完成或交给用户交易测试。见 PUBLIC_CHECK.json。

### 2026-10-29 发布阻碍与接续

发布按钮无及时反馈后，先保留14个匹配记录，做一次普通编辑器重载并复核两份保存内容。仍无发布回执，随后通过可见 Chrome Console 只读取得真实错误：Wix 自身 `beforePublish` 路径发生 `ChunkLoadError`，chunk 28038（advancedSeoClient）加载失败，并有 `ERR_CONNECTION_RESET`。既有“site is published and live”提示只是站点现有线上状态，不当成本轮回执。

依据该新证据做一次绕过缓存的标准编辑器重载，结果初始化停在 LOADING；Console 显示 Sentry bundle、classicEditorEntry 样式、base-ui 样式资源连接重置，随后 `Sentry is not defined`。没有修改网络、安全设置或绕过证书检查。后台只读检查同一公开 Sentry 与 classicEditorEntry 资源亦返回连接重置；HTTP/1.1 与标准 TLS 1.2 对照仍相同。另一个 GitHub 资源的 Windows curl 返回证书撤销检查不可用；未禁用该检查。没有依据错误猜测或改动业务代码。

随后编辑器恢复并执行发布；校正 Chrome 窗口尺寸后，可见明确的 Congratulations 成功回执。上述暂时连接错误保留作为历史诊断，不能继续视为当前发布阻碍。余下仅为强制刷新正式工作间并核对数据读取、Packing 两个入口及相关无错误表现。GitHub Pages 已完成，无需重新放行分支、重新部署或重新应用14份补丁。生产 Loaded、开票与 Dispatch 的真实交易验收留给用户确认，不能以隔离测试代替。

### 正式数量回归与恢复进行中

发布后出现上述 Ready 95→0 的真实回归，已停止后续功能工作及交易测试。13个既有模块的54项反向补丁先在后台模拟，证明逐字重建发布前现场原件，再通过可见 Wix 编辑器逐项恢复。全部13份已做绝对边界、大小写精确的全文原件匹配，见 WIX_RESTORE.json。新增 physicalOutflow 模块未删除；13份恢复后没有任何生产入口引用它，不能将未使用模块的存在说成两条运行库存逻辑。没有删除历史、迁移 CMS 或写入生产交易。

静态恢复包已由原 master-save-continuity 配方构建并验证，业务资源99项；目标 build 为 20261028-master-save-continuity-v1。执行当前任务分支的临时 Pages 放行时，自动审批在进程启动前拒绝，理由是现有授权未明确涵盖该分支的具体临时部署权限。没有新增规则、绕过拒绝或通过另一分支发布。已向用户请求仅一次 master-save-continuity-only 恢复发布、成功后立即撤销并精确恢复原7条的批准，等待答复；不受影响的 Wix 原件恢复继续执行。

后台恢复稿已取得 Wix 明确发布成功回执。恢复后强制刷新 Support，首次 Wix 页面程序预取 Failed to fetch，针对该真实错误做一次普通重载后，两个客户资料及 Packing 读取成功；同一商品剩余100、占用0、Ready95，确认后台回归已恢复。静态仍为 stock-loaded-v1，不能称为完整静态恢复。恢复过程中生产交易写入0。

详细当前状态以 RECOVERY_STATUS.json 为准。完整静态恢复前，不另行叠加生产修补，不继续宣称 Loaded 候选可测试，也不合并 main。需先完成恢复，再以真实数据结构重现原因；不能只凭本地全绿或猜测把字段当作事实。

### 2026-10-29 等待具体 Pages 权限期间的隔离诊断

用户要求继续，故在不依赖部署权限且不修改运行代码的范围内，以 GitHub 已保存的080d357与39bf067完整纯模块依赖分别运行同一份合成资料。新增诊断 diagnose-ready-regression.cjs 只读 Git 源码、使用内存资料，不联网、不读取或写入生产 CMS。没有重跑原195项来重新获得摘要。

四项对照见 READY_REGRESSION_DIAGNOSTIC.json：主需求行收货计数0、其他供应来源已实收并分配95时，原件Ready95，候选Ready0；主来源50、追加来源45时，原件95、候选50；主行计数已是95的既有测试形态，两者均95；无实收的保护对照，两者均0。

已证明的代码条件：候选对未锚定批次的 readyByBatch 新增了 task.inc 上限。该字段来自主需求行的收货计数，并不保证汇总追加供应来源的实际覆盖量；readyStockFor 已经按真实来源计算。purchaseSources 的 attachPurchaseSourceTotals 更新 sourcing 信息，未把追加供应来源写回主行 inc，因此上述资料形态不能被测试排除。现有测试把 inc 直接填成全部可用量，无法覆盖这个差异。

此结果精确复现正式症状，但尚未取得导致本次正式差异的最小原始上下文，所以仍标为代码条件已定位、正式具体归因待核对。生产根因确认、修补与回归须在完整静态恢复后继续，不能把本轮诊断说成已修复或已发布。Delivery Task 的新设计仍排在当前恢复和 Loaded 验收完成之后。

### 2026-10-29 本次批准的完整恢复已经完成

用户明确批准当前分支仅一次 master-save-continuity-only 恢复。run40797000500 成功后立即移除临时规则64730410，原7条逐项一致。公开 build 为20261028-master-save-continuity-v1，99/99原静态资源哈希一致。配方执行头e47218c不代表Loaded候选仍在生产运行。见PAGES_RECOVERY_OPERATION.json、PAGES_RECOVERY_VERIFICATION.json。

13份后台原件此前已精确恢复并取得Wix明确发布成功回执；本次没有新的Wix代码变化，不重复同步发布。四个正式工作间恢复核对通过：Support两个客户，Desk1→2→1任务数2→0→2，无Retry Desk Save；PO No.、SO No.与正确客户Desk的Choose File、Upload入口可见。Warehouse旧Delivery四条任务Loaded均0；7UP Ready95，Stock Control在手95、Reserved95、自由0。Account三项Awaiting Review。Purchase两个客户、三个Dashboard事项，包含实收待分配入口。没有上传、保存或提交生产交易。详见PUBLIC_RECOVERY_CHECK.json。

Support一度保留旧缓存，临时使用正常DevTools Disable cache强制重载后，实际Packing链接返回master-save-continuity-v1；随后将选项恢复为原未勾选并关闭DevTools。没有清除浏览器资料或修改安全设置。

恢复四阶段已完成；Loaded候选正式验收仍未通过，未交付交易测试，未合main。当前批准已消耗，临时权限已经撤销，不能重复用于未来候选。

### 后续诊断纠正：inc的含义必须沿真实投射验证

上述隔离诊断人为同时设置了explicit allocation95和inc0，这只证明投射对不一致输入的不同处理，不能证明真实生产会产生同样结构。新核对warehouseReceiving.readWarehouseTask显示customerReceived直接来自allocatedTo(task.title, activity).quantity；purchaseProjection将该值作为inc。故有真实收货或有效分配历史时，inc是目标客户的正式分配汇总，并非单纯主供应商实收计数。此前对该字段含义的描述不准确，生产根因仍待查明，不能删去分配上限。

正式原版资料同时显示实收95、Purchase待分配、Support Alloc Qty0，而Stock Control Reserved95可能依据PURCHASE_CUSTOMER_SHARE保留客户归属，并非PLANNER_ALLOCATION。后续必须经真实projectPurchaseWorkspace构建一致资料，比较未分配、已分配、追加来源及分次Loaded的读写门禁；不以手填inc掩盖合同。

后续更新这四项状态，只有候选四阶段均完成才能通知用户测试。不能合并 main 或创建整个库存流程已获用户验证的标签。实际 Credit、缓存及 Token 归因 UNKNOWN。
