/** True when a device got the push, or there was nothing to deliver. A failed attempt is false so the caller can retry. */
export function pushReachedSomeone(result: {
  sent?: number;
  failed?: number;
  nativeSent?: number;
  nativeFailed?: number;
}): boolean {
  const sent = (result.sent ?? 0) + (result.nativeSent ?? 0);
  const failed = (result.failed ?? 0) + (result.nativeFailed ?? 0);
  return sent > 0 || failed === 0;
}
