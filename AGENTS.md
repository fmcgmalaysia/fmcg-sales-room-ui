# FMCG repository operating supplement

## 2026-10-30 Purchase and Finance DOCS colors

Purchase PO/PI/DO/INV/CN buttons are orange when the shared state is MISSING, blue for an effective available file, and red for an unresolved document problem. Finance uses gray only before a corresponding shared state is available; it follows the same orange/blue/red state once available. Synchronization is bidirectional: a Finance issue must appear red in Purchase, and Purchase invalidation must appear red in Finance. Both consume the existing canonical documentStates projection; do not create another status store or change file, payment, financial lock or inventory behavior for this color request.

## 2026-10-30 MASTER 正式网址与空白页核对规则

用户要求将反复使用旧核对网址的问题写入 GitHub，作为后续工作的固定约束。

1. 正式访问使用已核实的干净部门网址：Purchase 为 https://fmcg999.wixstudio.com/master ，Finance 为 https://fmcg999.wixstudio.com/master/account-department ，Support 为 https://fmcg999.wixstudio.com/master/support-department ，Warehouse 为 https://fmcg999.wixstudio.com/master/warehouse-department 。根据要核对的部门选择路径；不能用 Purchase 首页代替 Finance 或其他部门验收。
2. 禁止从旧交接记录机械沿用带历史 release 参数的核对网址，例如 ?release=20261026-receipt-feedback-v1。默认去掉过期的核对参数；只有本次诊断确实需要时才使用，并记录具体用途。不得机械移除已验证业务必需的参数，也不改写生产路由或页面代码。
3. 旧 release 参数不是部署版本证据。确认运行版本必须读取实际嵌入地址、已加载资源的版本标记及正式页面结果，不能凭地址栏的旧参数声称运行某版本。
4. 首次打开后若为空白、about:blank 或未完成加载，先记录实际网址、嵌入地址、可见状态及相关错误，检查是否加载了目标部门。不得在没有新证据时反复打开同一旧链接、反复刷新或不断新建标签。需要新鲜访问时，优先使用干净网址或用户原正式书签；保护未保存表单。正常浏览器载入与工具载入表现不同时，记录差异，不把推测写成原因；安全停止或权限问题仍按既有规则处理，不能换入口绕过。
5. 不得未经证据就断言旧参数导致空白，也不得把重新打开后偶然成功当作根因已修复。若仍无法核对，保留接续点并明确未完成的验收步骤，不能报告正式页验收通过。


This short entry does not replace the parent project's AGENTS.md, START_HERE.md, system-ownership record or current task handoff. Follow all mandatory startup reading and protected-workflow rules. Preserve user-verified behaviour, minimum patches, live-versus-repository comparison, recovery points, stop commands, permissions and all four publishing stages. Do not develop or merge unverified work on main. This document grants no deployment, business-data or permission changes.

## 2026-10-20 工作效率补充规则

本节只减少无效操作，不撤销或改写既有的完整开工阅读、稳定性、现场核对、恢复、权限和四阶段发布法律。

1. 开工完成必读框架后，明确单一目标、必要文件、共享消费者及验收范围；不默认扫描整个项目。扩大范围必须有具体依赖或新证据。
2. 同一任务内复用已读的同版本、同片段内容；修改后、版本或现场状态变化、原输出不完整或上下文已丢失时重新读取，并在工作记录中简记原因。新任务的强制必读不豁免。
3. 工具失败先检查真实错误并修正原因，不原样盲目重试。Windows 下用 `rg -g '*.js' pattern directory`，不把 `directory/*.js` 当作文件路径。安全拒绝、权限不足和人工登录等待不得通过重试绕过。
4. 保留并复用已有测试输出，不为重新查看摘要而重跑。开发中先跑受影响测试；变更后重跑相关测试，发布前及共享模块改动仍完成所有规定的回归与验收。
5. 能共用同一现场快照的独立只读检查可合并；不合并有前后依赖的写入、发布确认或安全检查，不一次输出无关的大量内容。
6. 等待人工操作时保留恢复点、只通知一次必要动作，不反复打开页面。持续监控沿用用户批准的机制；新监控约定检查间隔与退避，不擅改现有自动化或停止已授权监控。
7. 重复读取、失败重试及全量重跑需要可说明的理由，优先复用现有记录，不增加逐调用长篇报告。Token、缓存、实际 Credit 分开记录；缺失为 UNKNOWN，不承诺未经测量的节省比例。

Detailed guidance: `docs/WORK_EFFICIENCY.md`. The numbered efficiency rules must match the local parent entry. Historical entrypoint restructuring requires separate approval.
