# Allocation Save feedback position — 2026-10-16

User requested moving the green saved/partially-arranged message above Save. Recovery source e12b268; existing limited annotated verified Purchase checkpoints remain unchanged. No main merge or new whole-workflow verification claim.

Fresh live supplier-allocation.js/style.css/index.html matched repository. Full fresh Wix page matched dashboard-entry-v1; after readback proved only src token changed. Exact snapshots retained locally.

Minimal presentation change: the same single allocationIssue node, including its ID, role, text and tone classes, moved from dialog body into a footer wrapper directly above the original Cancel/Save buttons. Four scoped CSS rules align feedback right with Save, separated6px. Feedback remains the same shared live-status element for success/pending/errors/reference feedback, with wrapping for longer messages. No state, validation, save handlers/payload, backend, CMS or permissions changed. Empty feedback remains hidden. Original footer button IDs are preserved.

104 existing affected checks passed,0 failed (allocation action colors/dialog/drafts/waiting and Purchase UI). No implementation-mirroring test added for this reversible layout change. Existing single local candidate reused. An unchanged sample plan produced 已保存 · 部分安排; measured message bottom476.4, Save top482.4, both right1292, green rgb(22,133,75). Local preview data only.

Release stages: front end8367368a1c3570d96e3b001871cf9d025a4e5133, Wix pointer7e15f0a. Pages38851471619 succeeded, marker2026-10-16-purchase-save-feedback-v1 and31 public assets exact; temporary rule63232346 removed/original7 restored. Wix only token synchronized, full readback exact and published/live receipt captured. Formal page refreshed only after confirming no modal, visible Save/Cancel or pending-result action; public visual acceptance is recorded separately below.

Evidence root: C:/FMCG-WIX-LOCAL/handoff/purchase-save-feedback-20261016/. Includes full before/after source, tests.txt, preview-saved.png, publish-receipt.png, policies and31-asset verification. No unrelated test changes/untracked files are included. Catch Cost/CBM proposal is not implemented by this layout patch.

Public acceptance currently incomplete: formal tab51425534 displays only outer shell after the clean refresh. Asked the user to refresh the existing page manually and report when the list appears; did not open a new formal window or force another refresh. Do not conclude fully published until actual public layout is verified.
