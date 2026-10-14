# FMCGMALAYSIA 与 MASTER 的系统归属和发布边界

2026-10-14。两个 Wix 系统使用同一个 GitHub 仓库 `fmcgmalaysia/fmcg-sales-room-ui` 和同一个 GitHub Pages 静态发布。目录已有职责区分；仓库名不代表所有代码属于 Sales Room。这里定义系统责任与后续工作边界，保留现有文件路径和已验证接口。

## 两个 Wix 系统

| 系统 | 工作范围 | Wix 正式入口 | 仓库主要位置 |
| --- | --- | --- | --- |
| FMCGMALAYSIA | Sales Room、Buyer Room、Catalogue；客户身份、选品、报价、客户交单及客户侧进度 | `https://fmcg999.wixstudio.com/fmcgmalaysia` | 根 `index.html`、`buyer-room.html`、`buyer-login.html`；`sales-room/`、`buyer-room/`、`backend/` |
| MASTER | Purchase、Account、Warehouse、Support；供应商分配、采购 P.O.、财务审核付款、收货、分货及发货 | `https://fmcg999.wixstudio.com/master` | `purchase-live/`、`account-room/`、`warehouse-room/`、`support-room/`；`integration/backend/`、`integration/wix/` |
| 共用展示资源 | 图标、静态资源和已有工作间展示组件 | 共用 GitHub Pages | `assets/`、`master-shared/` 及已有共享文件；按实际使用者确定回归范围 |

这些位置说明主要归属，不能替代具体文件的现场核对。历史副本、测试、Google Apps Script 和发布记录也在仓库内；文件存在不代表已部署。Catalogue 的历史编辑器副本必须与当前 Wix 代码比较后才能使用。

FMCGMALAYSIA 和 MASTER 的 Wix 页面、后台、CMS 和成员权限分别以各自现场系统为准。MASTER 中 NCT 与 GHR 是公司的业务隔离，不是两个独立 Wix 网站。MASTER 统一继承 Sales 的设计规范；共同视觉风格不改变业务权限或数据归属。

## 业务数据和跨站接口

| 数据或动作 | 权威来源和职责 |
| --- | --- |
| 客户身份、客户报价、Buyer 选品和客户交单 | FMCGMALAYSIA 及其已部署的 QD 生成／验证流程 |
| 供应商采购方案、采购数量、P.O. 与催款 | MASTER Purchase；付款跟进按 P.O. 组织 |
| 实际付款、供应商单据审核和财务结算 | MASTER Account |
| 实际收货及仓库操作记录 | MASTER Warehouse；Purchase 查看进度 |
| 预计发货日期 | Sales Room 修改，经现有接口投射到相关部门；其他部门按既有规则读取 |
| Catch Cost 参考价 | 既有 POINTBASE 来源；采购员确认的供应商价格与折扣用于本次采购计算 |

FMCGMALAYSIA 的 `backend/masterFulfilmentClient.js` 等客户端调用 MASTER 的现有服务；MASTER 的 `integration/backend/customerFulfilmentGateway.js` 等入口执行既有校验。跨站传递继续使用现有订单、任务身份、回执和字段映射。GitHub 保存版本与恢复记录，不能代替任何系统的业务数据权威。

QD 模板、中央生成器和客户生成的 QD 分别遵守项目 AGENTS.md 的权威定义。生成的客户 QD 是输出，不能反向成为模板标准。

## 仓库隔离与部署隔离

**目前是同仓库管理，已有目录分工，共用静态部署；尚未拆成两个仓库或两个独立 Pages 发布。** `.github/workflows/pages-v64-same-origin.yml` 上传整个仓库作为静态站，因此一次部署会更新两站所引用的静态资源。只改 Purchase 的 Wix 引用，不代表 Pages 只发布了 Purchase。

每个后续任务必须明确：所属 Wix 系统、修改文件、跨站消费者、各系统恢复点、实际需要切换的版本引用和验收范围。FMCGMALAYSIA 任务只同步其对应现场组件；MASTER 任务只同步对应 MASTER 组件；涉及既有跨站接口时分别核对两端。

共用 Pages 发布前后，要证明受影响系统的新资源正确，并核对另一系统的受保护资源保持相同。Wix 后台发布也有站点范围影响：即使只修改一个后台函数，仍需识别同站受保护消费者。所有发布继续报告代码、Pages、Wix live 和正式页面验收四项状态。

仓库拆分、静态部署拆分、路径迁移和后台重组属于单独架构任务，需要明确批准及兼容验收。当前定义先建立责任边界，不要求移动既有页面、资源或已验证模块。
