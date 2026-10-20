# FMCG repository operating supplement

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
