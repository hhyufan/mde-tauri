import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import useAuthStore from './useAuthStore';
import useFileIdStore from './useFileIdStore';

const USER_ID = 'file-id-store-test-user';

function logInAsTestUser() {
  useAuthStore.setState({
    user: { id: USER_ID, email: 'file-id-store@example.test' },
    token: 'test-token',
    isLoggedIn: true,
    loading: false,
  });
}

describe('useFileIdStore.bind', () => {
  beforeEach(() => {
    logInAsTestUser();
    useFileIdStore.getState().reset();
  });

  afterAll(() => {
    useFileIdStore.getState().reset();
    useAuthStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      loading: false,
    });
  });

  it('removes the old reverse mapping when a path is rebound to a new fileId', () => {
    const store = useFileIdStore.getState();
    store.bind('C:\\notes\\one.md', 'file-1');
    store.bind('C:\\notes\\one.md', 'file-2');

    expect(store.idOf('C:\\notes\\one.md')).toBe('file-2');
    expect(store.pathOf('file-1')).toBeNull();
    expect(store.pathOf('file-2')).toBe('C:\\notes\\one.md');
  });

  it('removes the old forward mapping when a fileId is rebound to a new path', () => {
    const store = useFileIdStore.getState();
    store.bind('C:\\notes\\old.md', 'file-1');
    store.bind('C:\\notes\\new.md', 'file-1');

    expect(store.idOf('C:\\notes\\old.md')).toBeNull();
    expect(store.idOf('C:\\notes\\new.md')).toBe('file-1');
    expect(store.pathOf('file-1')).toBe('C:\\notes\\new.md');
  });

  it('preserves a bijection when both sides of a binding were already occupied', () => {
    const store = useFileIdStore.getState();
    store.bind('C:\\notes\\alpha.md', 'file-alpha');
    store.bind('C:\\notes\\beta.md', 'file-beta');

    store.bind('C:\\notes\\alpha.md', 'file-beta');

    expect(store.idOf('C:\\notes\\alpha.md')).toBe('file-beta');
    expect(store.pathOf('file-beta')).toBe('C:\\notes\\alpha.md');
    expect(store.idOf('C:\\notes\\beta.md')).toBeNull();
    expect(store.pathOf('file-alpha')).toBeNull();
  });
});
