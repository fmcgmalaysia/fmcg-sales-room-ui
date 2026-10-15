# Purchase 新房间接续 — 2026-10-15（Asia/Kuala_Lumpur）

此文件区分已发布事实、未部署候选、仅构思内容。不能把图片或自动检查当作业务验收。

## 用户新规则：能后台处理的工作，禁止占用电脑

用户原话：“新房间规则：禁止你占用电脑处理能在后台的工作。”
代码读取/修改、计算推演、测试、GitHub提交/PR、文档、静态资源核对与能经既有接口进行的部署，一律后台处理，不激活Chrome、不移动鼠标、不输入键盘。仅必须依赖Wix界面的新鲜读回、最小同步、发布回执及真实可视验收才集中短时使用浏览器。先说明具体目标及后台工作已完成；沿用已有授权，不反复征求已获授权。不能因工具方便就把后台工作搬到UI。
用户计划重启电脑后到新房间继续；助手不要自行重启机器。重启不保证解除工具安全拦截。

## 强制读取顺序与单一目标

1. 工程根 AGENTS.md、START_HERE.md。
2. 根 handoff/system-boundaries-20261014/SYSTEM_OWNERSHIP.md、RECORD.txt。
3. 本文件，以及根 handoff/purchase-allocation-dialog-20261014/RECORD.txt 最后各段。
4. 任务相关代码、发布记录与既有测试。确认当前checkout/分支，先推演最小路径，再改动。
下一业务目标：Purchase 外层母子行与采购草稿工作效率。保持已完成弹窗、成本/FOC/库存/PO/保存保护；库存分配不是本次任务。

## Checkout / GitHub

根 C:/FMCG-WIX-LOCAL 不是Git仓库。
实际业务checkout：C:/FMCG-WIX-LOCAL/worktrees/nct-order-submit-room6-20261009。
业务候选：fix/master-independent-drafts-20261015，4704f2a0f6adf08e6c64a53d2bdb74b526976341，draft PR85。
本交接使用独立 docs/purchase-room-handoff-20261015；不要从文档分支发布网站。后续业务优先回到或基于上述已push的业务候选建立窄分支；不要重置/覆盖现有工作。
PR85：https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/85
前序PR82布局/audit、PR83条件原因、PR84自动预计库存均draft、未合main。
PR84：https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/84
main只允许用户实际验收过的版本。不得因为所有测试通过就合main或创建全Purchase verified标签。
未跟踪旧诊断txt不属于本任务；不要git add全部或清理。

## 当前线上事实（上次核对 + 用户回执）

正式入口：https://fmcg999.wixstudio.com/master?check=20261015-allocation-audit-v2
应用/Pages：70a0b59b57c284e9f4b5962c11983bec1de55705。
发布证据提交：43d0d75165534cac793eea38d6670ac51a593f72。
Pages run38678476288成功；18公开资源normalized exact，标记2026-10-15-allocation-audit-v2。
原有Source/FMCGMALAYSIA及共享资源保持不变；临时规则63107134已撤销，原7条规则恢复。
两个Wix后端已做新鲜原件核对、最小查找替换、完整读回一致。purchaseOperations26736CRLF字符，purchaseSources9275LF字符。Purchase页面仅旧版token切到20261015-allocation-audit-v2，完整读回一致。
用户明确说“发布了”，所以Wix发布获用户成功回执；随后正式页截图显示SCOMM5任务和旧单草稿阻挡。不能继续说Wix尚未发布。
但新成本/FOC/多来源真实SAVE、Catch Cost真实读回和全部公开流程尚未用户实测通过，不可称整个Purchase正式验收完成。
精确记录：integration/releases/master-allocation-surplus-20261015.json。该历史manifest的wixPublished仍false，是用户回执前状态；本文件及根RECORD的用户回执更晚，后续应在独立发布记录更新证据，不能把旧false当新事实。

## 已发布的弹窗规则：不要重新发明

以approved-dialog-layout-v3.png为批准的布局基准，后来用户明确要求00.00/00.00%紧凑数字框（仅宽度，不是金额上限）。
白色供应商行、独立普通/FOC方式、FOC子明细、手形Catch Cost、两位小数默认、点击数字全选；不横滚，可上下滚。
供应商选项排除其他行已使用供应商。
供应商/方式/数量/价格同一水平线，PO在最右独立列；PO与时间共用既有编辑入口。
去掉“已与供应商确认”的勾选，不伪造supplierConfirmed=true。
去掉总额计价下拉/省略号入口；历史TOTAL计价记录仍读回，不能删除后台兼容。
首次安排/新增来源补齐现有需求：原因选填；修改已保存方案、超量采购：原因必填；审计人/时间自动记录。
超量自动投射为预计库存，客户需求不变；不再让采购员勾选余货归处。实收后才产生实际库存。
普通/FOC保留原价折扣、付费/赠送、精确amountCents；母行客户成本与采购总额不能混算，赠品不等于超量。
保存/journal/重试/未知结果、财务/收货/开票锁继续保护。

## 已写好但未部署：跨产品独立草稿（PR85）

代码4704f2a，110检查通过，语法/diffcheck通过。公开app.js/allocation.js在修改前与已部署70a0b59一致。
当前代码：supplier-allocation.js按产品暂存未提交草稿；A未确定可继续编辑/保存B；切换时提示ROW+条码；取消B不丢A；serialize兼容旧单草稿缓存并保存parkedDrafts；不自动保存、不自动重发。
app.js仅增加rowLabel回调；index仅新cache keys/build2026-10-15-independent-drafts-v1。
进行中/未知结果的原请求仍不可切换活动保存上下文或重复提交，公司隔离保护未放宽。
PR85未部署、未真实验收、无需改Wixbridge或backend。不要把线上仍有阻挡误认为候选没修。
新增测试integration/tests/purchase-allocation-drafts.test.cjs。
发布记录integration/releases/master-independent-drafts-20261015.json。

## 已讨论、尚未实现的下一项

1. 外层母子行：多个采购来源的产品默认全部显示子行，无需展开/收起；单供应商不额外复制一行。
2. 母行保留CLEAR/ROW，显示产品/客户需求、已安排/待安排、实收、汇总成本/金额/GP和PO汇总。
3. 子行左侧不显示CLEAR/ROW，利用这些列留白缩进，背景从Description开始，行高更紧凑；数量/成本/金额/PO/进度仍按原表头对齐。不要简单删除td导致错列。
4. 子行保留tickbox，但移至供应商名称旁，用于选择具体采购来源及合并PO。保留现有data-select-kind=source、selectedSources、操作/权限机制；不能删除勾选功能。
5. 子行显示普通/FOC付费赠送、保存数量、成本、金额、PO/录入时间和进度。GP仅母行，子行空白。母行PO只汇总；子行/弹窗都打开既有PO编辑框，不直接造第二套编辑保存。
6. WAITING为未安排余量，不是供应商，不产生金额/PO/可选采购来源。
7. 部分采购无需全部找齐才SAVE。现有后端本已允许部分采购；最新MILO截图错误实为A改300低于此前实收350，不能为了允许部分保存而解除实收下限。
8. 同一产品供应商来源应能分别保存：A仍讨论，B已确定即可保存B；不自动提交/丢弃A草稿。这个“每供应商独立SAVE”尚未实现，PR85仅跨产品草稿。必须独立推演、沿用原journal和版本/份额保护，不能把整个产品所有未确认行一起验证后继续挡住B，也不能静默跳过错误行后宣称全部保存。
9. 不同供应商不能合并同PO；同供应商跨客户合并继续遵守现有规则，不借UI重排扩大权限。
10. 100任务应在外层扫读，不要求逐个打开弹窗。草稿仅提示位置，不应成为未提交工作间的全局锁。

## 构思图：尚未获实现验收，不是正式页面

- purchase-real-interface-concept-v2.png：最新图，基于用户实际Purchase截图的真实页面风格。
- mother-child-table-concept-v1.png：较早简表层级图。
- approved-dialog-layout-v3.png：此前用户批准的弹窗图；不是新母子行图。
最新真实风格图的示例金额：MILO需求500、安排470、WAITING30；A350×59.74=20909；B付100赠20、120箱平均20、金额2400；合计23309、平均49.59。全部是概念示例，不能拿图去写CMS或恢复业务数据。
生成图仍有局部示意误差（如实际收货子行/进度点数/顶部进度文字）；实现必须以真实数据与现有保护代码为准，不能照图片改业务事实。客户进度、库存、GP不得随意更名或重算。
图片仅用于讨论，用户尚未明确表示已最终批准该完整外层设计。

## 现有代码入口

purchase-live/task-grid.js、task-grid.css：外层母子行render与汇总。目前根行multiple>1时，PO栏data-expand-task按钮控制expandedTasks；子行含左侧勾选+ROW A/B编号，需最小UI改动。
purchase-live/app.js：既有排序/选择/selectedSources/PO入口；不要改数据身份、请求类型和后台职责。
purchase-live/supplier-allocation.js：新跨产品草稿候选，现仍产品内逐来源串行批处理；每来源SAVE须先认真看validate/next/receipt/receivedWorkspace及未知结果路径。
涉及task-grid时保护同文件Purchase Room与Active Orders，以及PO/财务/收货/分货/发票/出货读取。

## 验证与恢复

有限用户验证恢复标签verified/purchase-lavender-plan-po-20261014指向01e397cff395dcf30657f3643425de53cd5f889d，只覆盖Lavender20箱/66.05/1321.05/PO8465621的真实PLAN/PRICE/PO。
不得把它当整套FOC或当前设计验收。
旧MILO实收350及付款记录受保护；不要实际SAVE图里A300等低于已实收的测试草稿。
没有用户授权的可恢复真实业务记录时，用隔离fixture测试；不要冒充正式SAVE验收。
回归命令：node --test integration/tests/purchase-allocation-drafts.test.cjs integration/tests/purchase-allocation-dialog.test.cjs integration/tests/purchase-allocation-waiting.test.cjs integration/tests/purchase-allocation-audit.test.cjs integration/tests/purchase-live-ui.test.cjs integration/tests/procurement-handoff.test.cjs integration/tests/purchase-operations.test.cjs
110pass已记录，不变代码无需重复跑；后续新改动再跑必要范围。
根handoff/purchase-allocation-dialog-20261014保留全部exactWix副本、SHA、发布与本机测试结果。

## 浏览器阻挡与重启后策略

Computer Use曾在127.0.0.1失败页刷新时无法可靠确认URL，强制结束turn；之后即使用户切回Wix，自动审批也拒绝只读连接，不许换工具/间接调用绕过。
用户已授权可集中操作Wix及自行发布测试；这不撤销安全停止。重启后只做一次必要的只读连接恢复检查；若明确停止/拒绝，报告原文要点，不要无限重试、反复要求用户切页或重启。
遵守computer-use技能，先读框架和工具文档。允许的恢复检查成功后才操作；优先目的明确的浏览器工具。如工具明确不支持Native，不要臆造。
上次Chromeid132296和Notepad197492仅历史，重启后必须fresh inventory，不复用句柄或坐标。
本地preview8916服务重启电脑后会消失。先在后台启动并验证HTTP就绪，再访问，避免失败localhost页再次触发URL停止。不要直接刷新不可连接的预览。
预览服务脚本根handoff/purchase-allocation-dialog-20261014/preview-server.cjs，需path.resolve(root)版本，监听127.0.0.1:8916；普通sandbox套接字曾被拒，需要既有批准的host启动路径。隔离页/integration/tests/fixtures/purchase-allocation-preview.html?layout=v3无CMS写入。
任何原Purchase未提交草稿窗口不得擅自刷新/取消/保存。电脑重启后能否恢复tab/sessionStorage未知，不能承诺或伪造草稿恢复。

## 发布纪律

FMCGMALAYSIA与MASTER同GitHub仓库、同整仓库Pages部署，只有职责隔离，未物理拆仓/部署；不得混改Source。
四项分别报告：代码、Pages、Wixlive、真实公开验收。main保持未合。
后台工作先做完，临时精确部署规则发布后恢复原7条，不复用旧脚本hardcodedbranch/hash/policyid。
本handoff分支不部署。
