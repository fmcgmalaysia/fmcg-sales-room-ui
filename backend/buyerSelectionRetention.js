const retentionMs = 30 * 24 * 60 * 60 * 1000;

export function removedSelectionExpired(item, now = Date.now()) {
  const removedAt = Date.parse(item.removedTime);
  return Boolean(item.removed && Number.isFinite(removedAt) && now - removedAt >= retentionMs);
}
