// Isolated candidate for the recent/earlier read boundary. The authorized
// caller supplies one conversation's readers and its receipt projection.
const PAGE_SIZE = 20;

function readStableRecent({ readHead, readRange }) {
  return async function recent({ before, limit }) {
    // Storage publishes a new revision before removing the archived CMS rows.
    // A second strong head read detects a send or archive during the range read.
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = await readHead();
      if (!head) return { sequence: 0, archivedThrough: 0, messages: [] };
      const { revision, sequence, archivedThrough } = head;
      if (typeof revision !== 'string' || !revision || !Number.isSafeInteger(sequence) || sequence < 0
        || !Number.isSafeInteger(archivedThrough) || archivedThrough < 0 || archivedThrough > sequence) {
        throw Error('Invalid conversation head');
      }
      const through = before === null ? sequence : before - 1;
      if (!Number.isSafeInteger(through) || through < 0 || through > sequence) throw Error('Invalid history cursor');
      const from = Math.max(archivedThrough + 1, through - limit + 1);
      if (from > through) return { sequence, archivedThrough, messages: [] };
      const messages = await readRange({ from, through });
      if ((await readHead())?.revision === revision) return { sequence, archivedThrough, messages };
    }
    throw Error('Conversation changed while loading');
  };
}

function readSequencePage({ readRecent, readArchived, decorate = message => message }) {
  return async function page(before = null) {
    const { sequence, archivedThrough, messages: recent } = await readRecent({ before, limit: PAGE_SIZE });
    if (!Number.isSafeInteger(sequence) || sequence < 0 || !Number.isSafeInteger(archivedThrough)
      || archivedThrough < 0 || archivedThrough > sequence || !Array.isArray(recent)) {
      throw Error('Invalid conversation snapshot');
    }
    if (before !== null && (!Number.isSafeInteger(before) || before < 1 || before - 1 > sequence)) {
      throw Error('Invalid history cursor');
    }
    const newest = before === null ? sequence : before - 1;
    const oldest = Math.max(1, newest - PAGE_SIZE + 1);
    const recentFloor = Math.max(oldest, archivedThrough + 1);
    verifySequence(recent, recentFloor, newest);

    let archived = [];
    if (before !== null && oldest <= archivedThrough && oldest <= newest) {
      const through = Math.min(newest, archivedThrough);
      archived = await readArchived({ from: oldest, through });
      verifySequence(archived, oldest, through);
    }

    const messages = [...archived, ...recent];
    const first = messages[0]?.sequence;
    return {
      messages: messages.map(decorate),
      beforeSequence: first > 1 ? first : first === undefined && before === null && sequence > 0 ? sequence + 1 : null,
    };
  };
}

function verifySequence(messages, from, through) {
  const count = Math.max(0, through - from + 1);
  if (!Array.isArray(messages) || messages.length !== count
    || messages.some((message, index) => message?.sequence !== from + index)) {
    throw Error('Incomplete or unordered conversation page');
  }
}

module.exports = { readSequencePage, readStableRecent };
