# FMCG 系统收尾清单

2026年10月20日。覆盖本聊天的 Sales 调整、部门配合、库存闭环、财务历史和 Activity 优化，以及直接相关的已记录故障。这是有范围的收尾核对，不代表重新审计了整个项目的全部历史任务。

最重要的遗漏是 Sales 金额与 CBM 合列、Sales 四部门聊天入口，以及 Stock Card 库存闭环。原版 Requested Qty 拆单已有用户验收；新三选项调整已发布但实单验收仍待完成。Warehouse Ready Stock 已有数据投影，不能再称为完全没有数据源。

清单核对本身没有修改业务功能或数据。随后独立 PR210 发布任务已获明确临时权限并完成四阶段发布，临时权限已撤销、原七项恢复；没有执行真实排序或保存测试。整套真实业务测试按用户要求留到 Stock Card 完成后进行。

## 状态说明

- 已验收：有用户明确确认，冻结范围以验证记录为准。
- 已上线待验收：有发布或正式页面证据，但没有覆盖完整真实业务流程的用户验收。
- 代码完成未发布：候选代码存在，发布链路或正式使用尚未完成。
- 讨论未实施：本轮所查代码和交接记录没有提供完整实施证据。
- 待核实：只有历史异常或不完整证据，不能认定当前仍坏，也不能认定已修复。

下列大项可以包含已完成的基础和未完成的扩展，不能相互代替。

## 已完成或已有基础的功能

| 编号 | 需求 | 状态 | 已完成范围及保留边界 | 证据 |
| --- | --- | --- | --- | --- |
| A01 | Sales Requested Qty 拆成本次和下次发货 | 已验收 | 用户确认原版拆单“完美”；验证标签只冻结该版本及该流程。不能据此验收后来新增的加单、取消动作。 | [原版验证](../sales-split-rows-20261019/VERIFIED.json) |
| A02 | 极简两页 Order Adjustment，增加、分批、取消部分数量 | 已上线待验收 | PR208 已有 Pages、两站 Wix 发布回执；当前正式 Sales 显示 Requested 调整入口。加单、取消、采购批次联动的实际 Save 留待完整测试。 | [调整发布记录](../sales-order-adjustment-actions-20261020/RECORD.md) |
| A03 | 拆单后 Purchase 与 Warehouse 分别显示两条客户母行 | 已上线待验收 | 发布记录核对过实际拆单行；原供应商 PO、采购总量和实收不克隆。独立显示不等于产生两个供应商 PO。 | [调整发布记录](../sales-order-adjustment-actions-20261020/RECORD.md) |
| A04 | 已分单蓝色人头加供应商名，未分单橙色人头 | 已上线待验收 | PR208 正式 Purchase 已核对蓝色和橙色人头；当前公开资源与仓库一致。 | [调整发布记录](../sales-order-adjustment-actions-20261020/RECORD.md) |
| A05 | 财务蓝色 Task、Involved Suppliers、Total Amount、Partially Paid 看板 | 已上线待验收 | 当前公开 payment-layout.js 包含看板；七位金额容量、字体、Audit 完成蓝勾和桌面溢出修正有前端记录。原 Audit 记录开头的 candidate-only 已被后续 Finance 发布及当前资源比对覆盖，不能单凭旧开头认定未上线。 | [前端范围](../finance-audit-states-20261019/RECORD.md)、[后续发布](../finance-unified-supplier-20261019/RECORD.md) |
| A06 | 财务供应商待办、交易流水、审计历史分开 | 已上线待验收 | Active 与 Completed Audits、独立 Transaction History 和 Audit Trail、服务器过滤与分页已有正式记录。后台规模优化另见 U08。 | [财务发布记录](../finance-unified-supplier-20261019/RECORD.md) |
| A07 | 供应商结案不等客户销售发票 | 已上线待验收 | 财务结案门槛、原因、重开、资料变化后复核已实现；真实正向结案、重开和付款闭环仍待用户测试。 | [供应商结案](../supplier-account-closeout-20261018/RECORD.md) |
| A08 | 付款自动生成金额摘要，保留员工备注 | 已上线待验收 | 已发布、正式页只读打开核对；没有执行真实付款作为验收。 | [自动付款备注](../account-auto-payment-note-20261018/RECORD.md) |
| A09 | MASTER 部门聊天及未读、已读、确认 | 已上线待验收 | 现有任务聊天允许 Account 与 Purchase、Purchase 与 Warehouse、Support 与 Warehouse。已有消息验收及 Drive 文件验收，但不是 Sales 的 P、S、W、ACC 功能。多员工真实身份测试仍待补齐。 | [消息记录](../department-messages-20261018/RECORD.md)、[现有配对](../../integration/backend/taskChatService.js) |
| A10 | Warehouse 收货、整理、装货及照片证据 | 已上线待验收 | 工作间与保存机制已有发布；照片文件合成测试不等于真实备货、装货、发货全流程完成。 | [Warehouse 收尾](../warehouse-closeout-20261018/RECORD.md) |
| A11 | Warehouse Ready Stock 显示真实可用实收 | 已上线待验收 | 已接现有收货、分配和发货投影，并保留全部需求行。不是独立 Stock Card，也不是全仓未预留库存统一余额。零库存空白是展示规则。 | [Ready Stock](../warehouse-ready-stock-20261019/RECORD.md)、[投影函数](../../integration/backend/warehousePreparation.js) |
| A12 | Purchase 现有 Stock Allocation | 已上线待验收 | 已有按来源把实收货分给客户的机制及入口；这不等于“采购弹窗先分配全仓可用库存”的新 Planner 设计。 | [现有分配](../purchase-stock-allocation-copy-20261016/RECORD.txt)、[分配逻辑](../../integration/backend/plannerAllocation.js) |
| A13 | Sales 转 MASTER 超时后的回执恢复 | 已上线待验收 | 已有正式恢复成功记录，原单不重提；这不证明所有客户的 Order Progress 都正常。 | [回执恢复](../sales-master-receipt-recovery-20261019/RECORD.md) |
| A14 | 保存性能诊断及局部重读减量 | 已上线待验收 | 阶段计时和减少空毛利重复读取已经发布。整体保存仍慢，不能称为性能问题解决。 | [计时](../purchase-save-phase-timing-20261019/RECORD.md)、[局部优化](../purchase-workspace-read-20261019/RECORD.md) |

## 当前需要继续的工作

| 编号 | 工作 | 状态 | 尚缺内容 | 建议安排 |
| --- | --- | --- | --- | --- |
| U01 | Sales Line Amount 与 CBM 合并一列 | 讨论未实施 | 当前正式页仍分两列；用户要求上金额、下 CBM，列标题不再带 USD。 | 单独小补丁，保护金额计算。 |
| U02 | Sales 每行 P、S、W、ACC 四个聊天入口及未读数 | 讨论未实施 | 当前正式页没有四按钮；现有后端聊天配对也没有 SALES，不能只画按钮算完成。需订单行身份、接收部门、权限、未读规则和跨站桥接。 | 在库存设计前明确范围，再独立实施。 |
| U03 | 全系统统一的客户承诺数量 | 部分已实现，尚未完成统一验收 | Sales 优先读 committedQtyCtn；Buyer 普通行 trackingCommittedQty 仍读 customerReceivedQty，拆单行才用 activeQty。统一投影基础存在，但普通行、拆单行及汇总口径不完全一致。客户看到500→320→300的完整场景尚未验收。 | Stock Card 设计必须明确口径；不要再声称双方已经完全统一。 |
| U04 | Stock Card 和现存库存余额 | 讨论未实施 | 尚缺产品及库存维度、入出库关联、余额与历史、退货损耗、零库存保留、成本及盘点规则的完整实现。已有收货与分配是基础。 | 下一主线，先冻结数据源和余额定义。 |
| U05 | Purchase 兼 Planner，先库存后供应商 | 讨论未实施 | 尚缺统一可分配余额、库存预留、释放、多人竞争防超分、库存不足时的供应商余量行，以及任务栏相应库存信息。 | 依赖 U04；复用已有 supplier allocation 和 plannerAllocation，避免重做。 |
| U06 | Warehouse 提库存调整申请、Finance 审批和库存估值 | 讨论未实施 | 尚缺申请和审批流程、已预留40实有35时的短缺通知与补货安排、财务成本影响。用户拟定 Purchase 无调整库存权限，仍需落实。 | 与 U04/U05 一起定义权限及库存不足处理；不要让员工直接改 CMS。 |
| U07 | Sales 减量后的剩货完整转库存闭环 | 部分已实现，尚未完成统一验收 | 调整版本已有批次权益和释放分配保护；尚不能证明采购400、本次发350后，已收余货和未到余货都准确进入 Stock Card 并估值。未到货不能伪作实物库存。 | 随 U04/U05 完成；测试数量守恒、原PO与财务金额保持正确。 |
| U08 | 财务历史的大数据读取与索引正式启用 | 代码及发布基础已有，切换未完成 | 前端分页已完成；AccountReadIndex 曾 PLAN 成功、STAGE 被权限保护拒绝，记录显示0行且无激活。仍依赖完整业务投影。旧索引代次清理也未证明可安全进行。 | 等业务数量定义稳定后单独处理，不清旧历史链。 |
| U09 | Activity MOVE ROW 减量 | 已上线待实单验收 | PR210 两行补丁及六项新增测试完成；运行版 d109090 的 Pages、Wix 正式回执和公开 Purchase 只读检查均完成，临时权限已撤销。 | 不再是发布阻塞事项；实际排序及 CMS 减量测量留到 Stock Card 后。 |
| U10 | Activity 其他减量和全量读取优化 | 分析完成，尚未实施 | GP 重算、无变化保存、技术回执须逐项确认依赖；Purchase 当前仍读取整个 Activity。Catch Cost 当前参考查询没有直接新增 Activity，不需要重复优化。 | 先有证据再改；不与 Stock Card 重构捆绑。 |
| U11 | 从选品到财务完成的整套真实测试 | 尚未完成 | 需覆盖下单、确认、分单、库存预留、PO、收货、损耗、拆单加减、发票、装货发货、付款结案，以及两公司和不同员工权限。 | 按用户明确安排，Stock Card 后执行；之前只做必要代码与发布检查。 |

## 历史问题和候选方案需要再核实

| 编号 | 项目 | 可确认的边界 | 后续处理 |
| --- | --- | --- | --- |
| V01 | LAW 与 admin@fmcgmalaysia.com 的 Super Admin 身份 | 用户明确指定其身份。Oct19 财务 STAGE 曾因服务器识别非 SUPER ADMIN 被拒绝；没有新鲜证据证明当前服务器角色仍错或已修。 | 库存审批和索引管理前核对身份映射；不擅自改权限或绕过保护。 |
| V02 | 部分客户 Order Progress 加载失败 | 旧回执恢复记录曾观察一个客户失败；本轮当前 Sales 的另一客户可显示订单，不能据此关闭原问题。 | 同一客户正式只读复现与服务器错误核对，避免制造测试订单。 |
| V03 | 保存慢、504 和上传耗时 | 已有真实计时，局部优化不等于根因解决；上传工具选文件超时不证明网站上传失败。 | 保留问题，Stock Card 后用真实受控流程补测，不重复发送结果未知请求。 |
| V04 | 全站字体、双语和状态色是否完全一致 | 已有规范和多个局部发布；当前 Sales 正式文本仍可见部分旧斜线分隔。不能称全站逐项验收完成。 | 按后续相关界面逐处最小修改；Account 维持英语例外。 |
| V05 | MASTER 测试数据清理 | Oct18 确实清过指定备份集合；之后产生过新订单及标记性能测试记录。不能称当前CMS已完全干净。 | 正式测试前另列精确目标、备份和确认；本轮不清理，Source 由用户负责。 |

## 不应误算为新增待办的旧想法

- Committed Qty 胶囊改单后来被用户纠正为 Requested Qty；不要再按旧指示改回 Committed。
- 拆单不需要拆供应商原 PO，也不能再收一次相同实物货。两条客户母行与一个供应商 PO 可以同时成立。
- 早期红橙胶囊通知、采购员同意或拒绝改单的方案经过后续讨论调整；不能未经确认直接作为最终审批流程实施。
- 每三个月把全部 Activity 搬到 Drive 尚未获实施批准，也不适合作为按记录年龄自动删除的规则。
- 保留历史不代表将所有历史装进每次页面加载；两件事需要分别处理。
- Main 未合并不能等同于功能没上线；本项目通过任务分支发布，main 晋级仍受用户验收保护。

## 下一步顺序

U09 已完成独立发布，不再等待权限或编辑器恢复，也不恢复旧心跳。功能工作优先明确 U03 至 U07 的共同数量与库存规则，再做 Stock Card。U01 可作为独立低风险界面补丁；U02 涉及跨站与接收权限，需要独立范围，不能只按视觉按钮任务处理。U08/U10 不与库存业务重构混为一次改动。

整套测试前，先核实 V01 身份和 V05 测试数据边界，并准备可恢复的业务测试记录。完成一项就更新其状态及证据，不能用“本次发布成功”替代其他项目完成。

## 证据及本次核对范围

用户在本聊天确认原版拆单；对应 VERIFIED.json 保存了准确范围。PR208 新三动作不能继承原版的验收结论。PR210 功能提交 d690720、运行版 d109090、最终记录732c398；Actions39411470119 成功、六个公开资源一致、Wix 返回 published-live，干净 Purchase 刷新后 LAW 与11行任务正常、无捕获错误。没有实单排序或保存。完整证据见 PR210 的 handoff/activity-row-history-20261020/RECORD.md 和 RELEASE_STATUS.json。

本次七个公开资源均返回 HTTP200，与当前仓库对应文件按LF换行归一后完全一致：index.html、buyer-room.html、purchase-live/app.js、warehouse-room/workroom.js、account-room/payment-layout.js、account-room/payment-layout.css、account-room/purchase-payments.js。公开静态一致只证明该资源已部署，不代替 Wix 后端新鲜读回或真实业务测试。Sales 原有正式页只读核对显示 Order Progress、Requested 调整按钮、金额与CBM分列，未刷新或改动其表单。

对采购计划、库存、聊天和权限边界使用相应仓库模块与现有发布记录；本轮没有新鲜读回所有部门的Wix后台代码，没有重新扫描全项目，没有执行真实保存、付款、收货、发货或消息。历史候选与后来 release completion 以记录中最终状态为准；证据不足处保留待核实，不编造完成率。
