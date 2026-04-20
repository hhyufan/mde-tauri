import useAuthStore from './useAuthStore';

export const GUEST_USER_SCOPE = 'guest';

export function normalizeOwnerUserId(ownerUserId) {
  return String(ownerUserId || GUEST_USER_SCOPE);
}

export function getCurrentUserScopeId() {
  return normalizeOwnerUserId(useAuthStore.getState().user?.id);
}

export function isOwnedByUser(ownerUserId, userId) {
  return normalizeOwnerUserId(ownerUserId) === normalizeOwnerUserId(userId);
}
