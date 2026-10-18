# Finance status and document column spacing

User reported Status capsule touching Docs and Pay Slip header crowding Note. Actual public table measured1472px, Status140px with capsule140.56px plus12px cell padding, proving overflow. Docs164px accommodates147.9px control group plus12padding; no control resizing required. PaySlip58px had too little separation from Note.

Minimal presentation patch: Status164 (+24), PaySlip76 (+18), Docs164 unchanged; retain Note as flexible remainder and all other widths. Table minimum1440px preserves Note216px in Supplier Accounts and266px in Payment Plan at the minimum, with existing horizontal scrolling for narrow windows. Same fonts, capsule heights, buttons and handlers. Account version marker only; Purchase/backend/financial/file/notes mechanisms untouched.

Recovery: c7c77de current deployment, exact Wix entries/backend sources and receipts held privately in document-issue-feedback handoff. Existing user-verified Purchase invariants retained; the refresh acknowledgement is not a new financial transaction verification. Account current entry had just been fully read and matched expected single marker; no unexamined live conflict. New task is only correcting the reported crowded boundaries.

Validation and publication evidence to follow. Main unchanged.

Chrome actual candidate at1471.2px table: Status164, gap to first Docs23.44px, Docs164 unchanged, PaySlip76 and exact centered (offset0), Note297.2px. Existing26affected behavior checks pass; no business change.
