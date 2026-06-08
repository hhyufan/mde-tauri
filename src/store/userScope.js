/**
 * ??????????
 *
 * ?????????????????????????? store ?????????
 */
import useAuthStore from './useAuthStore';

/**
 * 游客态默认作用域标识。
 *
 * 用于在未登录时也能把本地持久化数据划分到稳定命名空间。
 */
export const GUEST_USER_SCOPE = 'guest';

/**
 * 归一化持久化记录中的用户归属标识。
 */
export function normalizeOwnerUserId(ownerUserId) {
  return String(ownerUserId || GUEST_USER_SCOPE);
}

/**
 * 读取当前会话对应的用户作用域 ID。
 */
export function getCurrentUserScopeId() {
  return normalizeOwnerUserId(useAuthStore.getState().user?.id);
}

/**
 * 判断一条记录是否属于指定用户作用域。
 */
export function isOwnedByUser(ownerUserId, userId) {
  return normalizeOwnerUserId(ownerUserId) === normalizeOwnerUserId(userId);
}
