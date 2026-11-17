import { createHash } from 'crypto';

function revisionId(customerId, selectionId, revision) {
  return 'mq_' + createHash('sha256').update(JSON.stringify([customerId, selectionId, revision])).digest('hex').slice(0, 29);
}

function matches(row, next) {
  return row?._id === next._id && row.customerId === next.customerId && row.selectionId === next.selectionId &&
    row.revision === next.revision && row.commandId === next.commandId && row.fingerprint === next.fingerprint;
}

// A private collection of immutable revision slots. A retry can recover an
// uncertain result but cannot replace the revision committed by another tab.
// The authority for request payloads and previous revisions is the server.
export function createMasterQuotationRevisionStore({ insert, read, latest }) {
  return {
    latest,
    at(customerId, selectionId, revision) {
      return read(revisionId(customerId, selectionId, revision));
    },
    async append({ customerId, selectionId, expectedRevision, commandId, fingerprint, snapshot }) {
      if (!customerId || !selectionId || !commandId || !fingerprint ||
          !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) {
        throw Error('Invalid quotation revision.');
      }
      const next = { _id: revisionId(customerId, selectionId, expectedRevision + 1), customerId, selectionId,
        revision: expectedRevision + 1, commandId, fingerprint, snapshot };

      const current = await latest(customerId, selectionId);
      if ((current?.revision ?? 0) !== expectedRevision) {
        const prior = current?.revision === next.revision ? current : await read(next._id);
        if (matches(prior, next)) return prior;
        throw Error('This quotation changed. Review the current revision.');
      }

      let stored;
      try { stored = await insert(next); }
      catch (error) {
        stored = await read(next._id);
        if (!stored) throw error;
      }
      if (!matches(stored, next)) throw Error('This quotation changed. Review the current revision.');
      return stored;
    }
  };
}
