# Stock Control 接续：Loaded 单次出库合同

日期：2026-10-28，Asia/Kuala_Lumpur。状态：后台诊断与实施路径已形成；生产补丁未开始。

## 用户新增硬条件：只保留一套库存逻辑

2026-10-28，用户反复明确“不要同时存在两套逻辑”“只能保有一套逻辑”，并授权开始。实施必须形成唯一的实物数量权威：Loaded成功保存形成一次出库，开单和Dispatch引用同一事实。不得保留可独立改变库存的旧Dispatch路径、按页面选择两种算法、自动回退旧算法或启用另一本库存账。旧采购/财务状态仍按其真实含义保留，不把状态读取机械替换成实物扣量。

历史已发货事实必须核对并承接到同一权威，不能以“历史兼容”为名留下第二条运行扣量公式。身份无法对应的旧Loaded/Dispatch须显式核对，不能用两套累计值相加或max掩盖重复。切换验收包含Purchase分配、收货更正、Warehouse可装量、Support开单、Stock Control及跨站数量消费者的共同结果。

用户已按请求手动切到现有MASTER编辑器，工具新鲜识别到正确窗口和Wix站点URL；先前URL识别停止条件已有外部状态变化，当前继续正常只读核对，未绕过安全停止。后台全文比较仍待完成，不能仅以窗口恢复宣布基准已核对。

后续现场进展：十二个当前保存的Wix后台模块已通过完整、大小写敏感、绝对首尾锚定的编辑器正则匹配，与080d357原文LF标准化一致。详见EDITOR_COMPARISON.json；精确对应恢复原文与哈希保存在根专题live-readback-20261028。没有编辑代码或点击发布。此证据验证当前保存代码，不声称本轮独立确认了线上后台的部署版本。

读取方式说明：工具对全文选择只返回700字符摘要，普通剪贴板读取为空，均未当作全文成功。随后使用正常可见编辑器Find，对转义的完整仓库原文作严格首尾匹配，逐文件取得1 of 1；Match Case与Regex可见启用。未读取隐藏Monaco状态。文件打开/界面刷新异步时等状态变化后核对；一次误触编辑器预览快捷键已返回编辑模式，无代码修改。用户曾调整/最小化窗口，更新新窗口绑定后继续，未反复使用旧绑定输入。

唯一权威静态门禁：map-consumers.cjs在明确依赖范围integration/backend的84个模块内建立导入闭包，定位11个直接数量消费者、13个受影响入口。CONSUMERS.json给出确切路径；其中四个实物读取模块仍有五处根据Dispatch状态独立计算数量。--require-single-authority当前故意非零退出、singleAuthorityGatePassed=false，不能将它说成新逻辑已经完成。财务状态、发票金额和应收不属于这五处，不作机械替换。静态门禁只能证明必要条件，最终还必须通过真实数量、并发与恢复场景。

## 授权与当前范围

用户在专题聊天室完成讨论后要求交回原工作聊天室接续；随后要求先完整推演，再说已切换模型、可以开始工作。本阶段只解决一个目标：将成功提交的实际 Loaded 接为唯一一次实物出库，并让后续开单与旧 Dispatch 引用该结果。

最终业务决定及确认等级以根目录 handoff/stock-control-discussion-20261028/HANDOFF.md 后续确认段为准，不能采用文件开头历史的“定义未确认”。产品月记录、Drive 归档、待审坏货限制及若干纠错规则仍是建议或待定；本阶段不启用旧库存候选，也不迁移或删除 CMS。

## 基准和恢复证据

- 实际 checkout：C:/FMCG-WIX-LOCAL/worktrees/receipt-feedback-20261026。
- 开始时 HEAD：080d3578fbddc0995938a08d452828cc24e12f6d，分支 perf/master-save-continuity-20261028；工作区干净。
- 当前运行记录：e71bf4934f8c5347b13dd0802f9da227b5ccf83b，20261028-master-save-continuity-v1；Pages 40573558609。此前记录四个主工作间验证，Packing 正式入口验收仍有缺口，不将其称为全流程已验收。
- 现有 annotated verified/stop-waiting-cn-20261026 指向 911d31a59b6e6e44962dc678445f65ac192430a8，仅保护其 Stop Waiting/CN 范围，不能冒充整套库存的用户验证基准。
- 本次创建 test/stock-loaded-contract-20261028，仅增加合成诊断与记录，不改运行源。撤回诊断分支不需要回滚生产。
- 上个工作回合 computer-use 在尝试选择 MASTER 编辑器时强制停止：无法可靠判断当前浏览器 URL。没有绕过、换工具操纵同一受限页面或原样重试。Wix 后台新鲜全文比对仍缺失。
- 生产编辑前仍须取得并保存相关现场代码全文/哈希、与仓库比较及当前发布身份；若冲突则停止写入。已有静态五文件核对见根专题 audit-20261028/PUBLIC_READBACK.json，不能代替 Wix 后台新鲜读取。

## 新完成的可执行场景

运行 integration/prototypes/stock-loaded-contract-20261028/check-current.cjs，实际加载仓库既有后台模块，使用内存 store 与合成身份，无网络、真实 CMS 或文件服务调用。结果文件 CURRENT_OBSERVATIONS.json。

场景初始 A 实收50、B实收100；明确分配 A50 来源给A、B来源各50给A和B，总实物150、客户覆盖150。该初始化只表示现有跨客户分配，不伪称已建立可操作的借补责任。

| 原有路径 | 用户规则应得结果 | 原程序实测结果 |
| --- | --- | --- |
| Legacy PACK → LOAD 80 | 在手70，剩余实物覆盖70 | 在手150，覆盖150 |
| Legacy LOAD 80 → INVOICE | 保持70 | 仍150 |
| 随后旧 DISPATCH 80 | 保持70，不再扣第二次 | 此时才变70 |
| Legacy LOAD 100 | 在手50，覆盖50 | 在手150，覆盖150 |
| Legacy LOAD 100 → INVOICE | 保持50 | 仍150 |
| 随后旧 DISPATCH 100 | 保持50 | 此时才变50 |
| Packing PROGRESS Loaded80 → COMPLETE | 在手70 | 两步后仍150 |
| Packing COMPLETE Loaded80 → 主Support开单读取 | 可开已确认80 | maxInvoiceQty为0 |
| Packing PROGRESS Loaded100 → COMPLETE | 在手50 | 两步后仍150 |
| Packing COMPLETE Loaded100 → 主Support开单读取 | 可开已确认100 | maxInvoiceQty为0 |

14项数量/衔接观察中12项与目标不同、2项仅旧Dispatch最终累计量相符，readyForRelease=false。诊断正常退出只表示已完成观察，绝非业务验收成功。--require-ready 会在尚有缺口时返回非零。

18项保护断言通过：两个 Legacy 数量场景的丢回执同请求重试不重复、Loaded读回、旧版本拒绝、同请求内容不可改、实收原数不变、公司隔离；两个 Packing 场景均仅一条 CURRENT、局部 invoice helper 按实装量、少装余量保留。

另外只运行一次受影响既有九个测试文件，共72/72通过，未改断言：warehouse-preparation、customer-fulfilment、stock-card-projection、stock-control-service、packing-list、packing-list-operations、packing-list-context、packing-list-guards、packing-consumer-integration。这证明旧合同仍可复现，并不说明新业务已实现。没有重跑全站测试获取摘要。

## 必须复用的现有机制

1. purchaseOperationJournal 的公司串行写、请求身份、输入摘要、PREPARED/RESULT及原请求恢复。
2. 收货事实、来源PO、公司/规格/客户身份、显式allocation、原财务/发票快照和FX锁。
3. 现有两个装货保存入口的身份和权限、照片/有效期证据及版本检查。
4. Packing CURRENT复用、SENT前草稿不可见、清单占用和跨入口防重复安排保护。

不通过把 LOAD 改写成旧 DISPATCH 来实现：旧 DISPATCH 需要先有发票，而用户顺序是 Loaded 后开单。也不能只在 Stock Card 展示层减数量：其他分配/装货消费者会继续使用旧在手，产生双重使用风险。

## 最小接入路径（待现场比对后实施）

先在两个实际保存点明确记录本次出库使用的稳定装货身份、累计Loaded及对应真实来源消耗。来源分摊沿原显式分配合同核对并保存，不能等开票时按后来已改变的allocation猜测。Loaded是累计值，多次保存不能每次全量扣减；相同请求只产生同一结果。

库存和客户覆盖的读者统一读取这一已确认实物消耗；旧Dispatch对已关联Loaded只补业务事实，不再新增同批实物消耗。保留既有历史Dispatch的真实结果，历史Loaded与Dispatch是否属于同批必须可核对，不能将所有Loaded与所有Dispatch无条件相加或用max掩盖身份不明。

再使Support主开单路径使用相同已确认Loaded及来源依据；Packing局部packingInvoiceLines已经使用Loaded，但主supportInvoiceState目前读取Legacy且清单hold阻止开单。接通时必须按清单/Desk身份释放或承接对应占用，不能删掉requirePackingReleased或全局忽略hold。

定向检查/预期影响的模块：warehousePreparation、packingListOperations/model/context、customerShipmentLedger、inventoryExceptions、stockCardProjection、customerFulfilment、supportInvoice及其实际调用服务。实际补丁文件数只能在新鲜现场及依赖核对后确定，不承诺一行修复。不得因此重写整页或顺便改CMS生命周期。

共享消费者验收须覆盖 Purchase allocation、Warehouse准备/装货、Support开票、库存异常隔离和Stock Control，以及Sales/Buyer数量投射。只有存在实际依赖才扩大到其他模块。

## 上线前必须解决的边界

- 两个Loaded入口与Desk/Shipment/来源的一一关联；不能把同一实物经两个入口重复提交。
- 首次保存、分次累计、完全相同重复保存、丢回执、并发旧版本、跨公司和多产品中断恢复。
- 150 → Loaded80后70 → 开票70 → Dispatch仍70；再累计Loaded100时只能再出20，最终50。
- 完成80/计划100后的20只释放清单占用，不自动视为已取消客户需求或已形成公司自由货；取消/拆单须由后续受控Support动作完成。
- 已扣Loaded下调可能是记录纠错，也可能真实卸回。尚未定义其完整业务合同；不得自动加回可用货。现有允许下调/REOPEN的行为需要有证据的最小兼容处理，不能默默取消用户原功能。
- 不能以出库完成清掉借补义务。本诊断未建立借补writer，借补跨月验收在后续阶段独立完成。
- 新旧历史对账及部署切换：不能重记已有Dispatch或将未能识别来源的Loaded凭空扣给某个客户。

## 后续阶段

第二阶段接首次allocation后的产品行数量交接、Support少装取消/拆单和Purchase借货/补回，保留未结行入口。第三阶段接同源Current Stock和采购成本视图、Warehouse问题报告/授权逐项调整。最后验证一天停业Closing、产品月有界明细、旧月归档及恢复；未结责任和角色待办跨月保留。各阶段独立补丁、回归和四阶段发布，不将整个方案一次替换生产。

## 四阶段发布状态

- 代码：合成诊断和路径记录完成，生产补丁未开始。
- GitHub Pages：本阶段未部署。
- Wix Studio：本阶段未同步或发布，后台新鲜比对未完成。
- 正式页：未执行真实库存交易验收。

下一继续点是恢复受支持的Wix只读核对能力，保存相关后台精确基线后接入Loaded单次出库；在此之前可继续后台合同验证，不能越过现场权威要求。Token、缓存和实际Credit归因UNKNOWN。
