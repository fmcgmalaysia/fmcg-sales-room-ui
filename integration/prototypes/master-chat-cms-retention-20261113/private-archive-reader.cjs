// The QA server supplies an authenticated Drive reader and fixed file ID.
// No browser or chat caller can choose the file to fetch.
function createQaArchiveReader({ readFile, fileId, conversation }) {
  return async function readArchived({ from, through }) {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(through) || from < 1 || through < from || through - from >= 20) {
      throw Error('Invalid archive range');
    }
    const archive = JSON.parse(await readFile(fileId));
    if (archive?.fixture !== 'MASTER_CHAT_RETENTION_QA_V1' || archive.conversation !== conversation
      || !Number.isSafeInteger(archive.fromSequence) || !Number.isSafeInteger(archive.throughSequence)
      || archive.fromSequence < 1 || archive.throughSequence < archive.fromSequence
      || !Array.isArray(archive.messages) || archive.messages.length !== archive.throughSequence - archive.fromSequence + 1
      || archive.messages.some((message, index) => message?.sequence !== archive.fromSequence + index
        || !['WAREHOUSE', 'SUPPORT'].includes(message.from) || typeof message.body !== 'string')) {
      throw Error('Unexpected QA archive content');
    }
    if (from < archive.fromSequence || through > archive.throughSequence) throw Error('QA archive does not cover the requested page');
    return archive.messages.slice(from - archive.fromSequence, through - archive.fromSequence + 1);
  };
}

module.exports = { createQaArchiveReader };
