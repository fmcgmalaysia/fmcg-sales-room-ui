# Finance payment controls alignment

User screenshot feedback: Edit plan must use blue underlined text; Pay Slip header and buttons centered together. Two scoped CSS declarations only. Existing column widths, fonts, click handlers, financial calculations and file workflows unchanged. Stacked on document-issue candidate e7ff475/PR182; not a separate live baseline. Current Wix draft backend issue changes have been read back exactly and remain unpublished; page pointer still prior column draft. Original runtime fae019d unchanged.

Payment-note question: recommended generated payment summary (Requested, Paid this time, Total paid where relevant, Remaining) separate from optional purchaser note. This CSS patch does not change payment notes, amounts or persistence.

Validation: Chrome actual frontend candidate, Edit plan computed blue/underline, Pay Slip th/td centered; note area and file spacing preserved. Publication pending all four release stages.
