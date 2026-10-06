# FMCG ROOM 5 当前交接状态

更新：2026-10-06，Asia/Kuala_Lumpur。用途：版本与工作状态索引；线上 Wix、已部署中央 Apps Script、live QD TEMPLATE 仍是各自权威，不得用此文档覆盖未核对的线上代码。

## 已验收、须保持

| 项目 | 恢复点／记录 | 验收范围 |
|---|---|---|
| Catalogue：Brand Name → Sort No；CBM 四位显示 | verified/catalogue-brand-sort-20261006，PR #8 | 用户确认“完美了”；不代表全部上游同步路径已验收 |
| My Selection：FOOD → NON-FOOD → Brand Name → Sort No | verified/my-selection-sort-20261006，PR #9 | 用户确认可以收尾 |
| QTY 保存、框外铅笔、四位宽度、43px 行高与上下键 | verified/buyer-quantity-blur-20261006、verified/buyer-quantity-arrows-20261006；最新 commit 8e093fbd70ae0a84b79ef50f1d61fb4bd88c8652 | 失焦保存“测试完美”；上下键“完美，你可以收尾了”。时间与人员一行显示及既有布局随此基准保留 |
| QD 发布前后排序：FOOD → NON FOOD → OTHERS → Sort No | verified/qd-publish-category-sort-20261006，PR #15，Code.gs 3.2.2 | 用户确认“QD PUBLISH完美了”；只涉及 TEMPLATE 与 BERJAYA 06 的保存 Head |

最新 Buyer Pages marker：2026-10-06-buyer-quantity-arrows-room5-v1；公开部署 run 37422845931。实际 CSS 与 inline script 在收尾时与 8e093fb 基准一致。临时部署权限已撤销，github-pages 仅允许 main。

QD Code.gs 归一化 SHA256：8bf97063f4dab56e75e63c0e46df9d54e25cb9faa3c860ccfdb560a9c936215e。模板与 BERJAYA 06 当前在线 Code.gs、CatchCost.gs 均已读回并匹配。完整副本及身份见 handoff/verified-qd-publish-category-sort-20261006/。该绑定菜单执行保存 Head，无独立 web deployment／immutable version。旧客户不会自动继承后来的模板脚本。

## 明确暂停，不得当作完成

Sales Room Entry 蓝色 PUBLISH：用户已要求暂停。中央仍是原部署 Version 16（2026-10-04 19:50）。Wix 报价函数当前仅含六行诊断代码及 HTTP 状态／响应类型字段，记录在 draft PR #16。

同一业务代码曾在 6.427 秒返回 HTTP 200／JSON、20 unchanged、0 failed；后来有界测试第 1 次返回 HTTP 404／HTML，耗时 17.575 秒，前端 504。余下两次已取消。未确定 404 来自初始请求还是 ContentService 重定向；不得宣称已修复。逐跳方案没有获准或应用。不得继续修改、发布、重试此任务。完整暂停状态与原源码见 handoff/paused-sales-publish-20261006/。

读取批量优化候选曾形成中央 Version 17，已回退；该候选不是生产权威。POINTBASE 早期 draft-access 候选也已回退，不能恢复。POINTBASE 当前保存脚本以 PR #6 的 20/9 基线加 BRAND NAME 映射与数值 CBM 舍入为准；实际新增条码／完整开户路径没有在本次收尾重新运行。

## 本次收尾边界

1. PR #12、#13、#14、#15 的过期发布／验收说明已纠正；#12、#13、#15 已可审阅。#14 的 3.2.1 为历史记录，当前权威是 #15 的 3.2.2。
2. PR #16 已更新 404 事实并保持 draft／暂停。原始私人日志、截图及真实成本数据只保留本地，不上传 GitHub。
3. Escape 的 closeQuoteDetail 未定义调用是独立缺陷；补丁、测试和发布各阶段需单独记录，不得改 QTY、下载、报价或通知逻辑。
4. main 在核对时仍为 d16cd1bfd311b58e772c802f92d498e39dbb91b3（Buyer marker 2026-10-04-selection-same-site-download-v98；QD 3.2.0）。不能从旧 main 部署覆盖已验收线上版本。主分支整合须审查最终差异、保持已验收行为，不得把暂停诊断／失败候选称为已验收生产修复。

## 尚未实现／未单独验收的业务

PO Number、Proforma 设计、选单合并、Master 完成送货触发的新归档规则仍是待办。PR #4 的提交后锁定、Sales 转交前改量及 Edit History 有助手测试记录，尚未得到该整条流程的独立用户实测验收；不得因为其他 QTY 任务完美就扩大验收范围。

用户本次明确保留 Order Form 现有报价／数量行为：保存 QTY 是输入锁，尚未交单时使用已发布报价；交单后保留提交时锁定价格。不要追加价格变化提示或改造此流程。

## 下次开工

先读工程 AGENTS.md、START_HERE.md 和本文；按新任务只读核对 live 与 repository。10 月 5 日旧交接索引是历史，不代表当前工作状态。任何已暂停事项须获得明确恢复指令；确认一个单一目标、最小改动、恢复点与验收方法后再编辑。

用户在本次收尾明确回复“尚未亲自测试整条流程”（PR #4）。因此不得整条合并包含该流程的当前分支至 main；main 整合保留待验收依赖，不进行自动发布。当前线上流程保持原状。

恢复标签按系统范围使用：QD 标签仅用于 QD 绑定脚本恢复，不得把 QD 标签所在的整套旧 checkout 用来部署 Pages。诊断 PR #16、批量读取 Version 17、POINTBASE draft-access 候选均不能作为已验收恢复点。

收尾归档 PR：https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/17（maintenance/room5-closeout-20261006，仅记录）。Escape 独立补丁 PR：https://github.com/fmcgmalaysia/fmcg-sales-room-ui/pull/18，代码 ecfb4a8，21 项检查通过；marker 2026-10-06-buyer-escape-close-room5-v1。当前 Pages／Wix／公开页验证均待发布，不能称已上线。
