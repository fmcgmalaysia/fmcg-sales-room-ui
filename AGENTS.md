## 2026-11-02 R2 retirement record

R2 has been removed from both live Wix sites:122 files,3 HTTP routes,1 dedicated test page and16 empty collections. `integration/releases/r2-retirement-20261102.json` is the exact record. Sources under the old isolated-cohort prototype are retained offline as history, not an active workflow or deployment baseline. Formal business data was retained; clearing fake business records is a separate authorized task requiring its own exact scope and verification.

# FMCG repository operating supplement

## 2026-11-02 Sales Department belongs only to MASTER

Sales Department is an internal MASTER department, never part of FMCG Malaysia Sales Room, Buyer Room or Catalogue. Internal purchase cost, profit, GP and commission data must not be returned through FMCG Malaysia pages, web methods or cross-site customer interfaces. Remove the mistakenly added source-site Sales Department integration completely, not merely its menu. Preserve the existing sanitized customer transaction/payment/file history. MASTER must authenticate its own staff and enforce each salesperson's authoritative customer ownership server-side; submitting an order is not evidence of customer ownership. Do not introduce a second login, duplicate financial ledger or infer assignment from a submitting admin.

用户随后明确：Sales Room 客户工作可换员工并传承历史；MASTER 内部名称采用 Sales Management，老板查看所有销售员，个人只看本人交易业绩、利润及佣金。当前客户服务负责人和历史交易业绩归属必须分开：更换客户负责人不能自动转移旧交易的业绩/佣金。交易所属销售员必须有权威证据，不能用当前客户负责人、订单提交人、Support 开单人或 Finance 收款人代替。历史归属缺失必须明确待核对，不猜测。名称及上述权限/归属是目标规范，不代表已经在 MASTER 上线。

## 2026-10-31 Quantity and date typography

用户要求全站沿用统一的字体、字样和语义配色，禁止各列自行选择字体或字距。数量胶囊复用共同样式和统一高度；日期使用正常数字字距，不继承数量列的等宽数字样式。已知尚无收货/分配可展示浅橙色0，但不得把无法确认或矛盾的数据冒充真实0；默认展示值不得参与业务或异常计算。EXTRA只在图标本身用浅蓝色，来源图标与人头同尺寸、同蓝色。当前Active本轮候选统一为19px数量胶囊、11px/600数量、10px/400日期和16px来源图标；按实际正式页逐项验收，不能以记录规范声称全站已全部完成。不改变权限、付款、库存或借还货规则。

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

### 浏览器卡页恢复与前台归还 — 2026-11-16

1. **后台为默认。** 代码、测试、打包、GitHub、文档和可用接口完成的操作留在后台。只有必须用实际浏览器画面、需要点击的编辑器步骤，或需要恢复卡住的页面时，才短时使用前台。使用前简短说明本次前台动作。
2. **卡住就检查并换一个标签。** 如果后台打开页面后卡住、空白或无法确认载入，先核对目标网址、页面状态、未保存内容及正在进行的提交、上传或发布。确认安全后，只关闭卡住的目标标签，在前台用已核对的干净网址或正式书签新开一个标签。确认地址、目标站点和所需编辑区均已加载。保留有未保存工作或结果未明的标签，不重启 Chrome 或 Codex，也不后台反复开页。
3. **一恢复就归还屏幕。** 所需页面或操作一旦就绪，立刻停止前台键鼠操作。有可安全恢复的原窗口则切回，后续核对、等待和执行回到后台。长时间加载和部署等待期间也归还屏幕。再次使用前台须有具体的界面动作。
4. **区分应用卡顿与工具安全停止。** 普通卡页按上面步骤恢复。遇到工具明确安全停止、登录或授权拦截，遵守该工具的边界并保留恢复点。可继续的后台工作照常进行。

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
