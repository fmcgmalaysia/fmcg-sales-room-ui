// The channel carries only a generic refresh signal; customer and product
// details remain protected behind the existing staff-only web methods.
export function realtime_check_permission(channel) {
  return { read: String(channel?.name || '') === 'sales-room-signals' };
}
