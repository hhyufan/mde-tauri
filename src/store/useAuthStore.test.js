import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  post: vi.fn(), load: vi.fn(),
  store: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), save: vi.fn() },
  getCredential: vi.fn(), setCredential: vi.fn(), deleteCredential: vi.fn(),
}));
vi.mock('@/services/apiClient', () => ({ default: { post: mocks.post } }));
vi.mock('@tauri-apps/plugin-store', () => ({ load: mocks.load }));
vi.mock('@utils/tauriApi', () => ({
  getRefreshCredential: mocks.getCredential,
  setRefreshCredential: mocks.setCredential,
  deleteRefreshCredential: mocks.deleteCredential,
}));

let store;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.load.mockResolvedValue(mocks.store);
  mocks.store.get.mockResolvedValue({ id: 'user' });
  mocks.getCredential.mockResolvedValue('stored-credential');
  mocks.post.mockResolvedValue({ data: {
    user: { id: 'user' }, access_token: 'access', refreshToken: 'rotated-credential',
  } });
  store = (await import('./useAuthStore')).default;
});

describe('authentication session recovery', () => {
  it('shares StrictMode startup and concurrent refreshes without rotating the credential twice', async () => {
    await Promise.all([store.getState().loadToken(), store.getState().loadToken(), store.getState().refreshToken()]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.setCredential).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ isLoggedIn: true, token: 'access', user: { id: 'user' } });
    await store.getState().loadToken();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('removes rejected credentials once and does not retry them on the next startup', async () => {
    mocks.post.mockRejectedValue({ response: { status: 401 } });
    mocks.deleteCredential.mockImplementation(async () => { mocks.getCredential.mockResolvedValue(null); });
    mocks.store.delete.mockImplementation(async (key) => {
      if (key === 'user') mocks.store.get.mockResolvedValue(null);
    });
    await Promise.all([store.getState().loadToken(), store.getState().loadToken()]);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.deleteCredential).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ user: null, token: null, isLoggedIn: false });
    await store.getState().loadToken();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalledWith('/auth/logout', expect.anything());
  });

  it('retains credentials after a temporary network failure for a later retry', async () => {
    mocks.post.mockRejectedValueOnce({ code: 'ERR_NETWORK' });
    await store.getState().loadToken();
    expect(mocks.deleteCredential).not.toHaveBeenCalled();
    await store.getState().loadToken();
    expect(store.getState().isLoggedIn).toBe(true);
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('cannot restore a session after logout while its refresh is still in flight', async () => {
    let complete;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const refresh = store.getState().refreshToken();
    const rejected = expect(refresh).rejects.toThrow('Authentication session changed');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await store.getState().logout();
    complete({ data: { user: { id: 'user' }, access_token: 'access', refreshToken: 'rotated-credential' } });
    await rejected;
    expect(store.getState()).toMatchObject({ user: null, token: null, isLoggedIn: false });
    expect(mocks.setCredential).not.toHaveBeenCalled();
  });

  it('clears native credentials even when local store cleanup fails', async () => {
    mocks.store.delete.mockRejectedValueOnce(new Error('store unavailable'));
    await store.getState().clearSession();
    expect(mocks.deleteCredential).toHaveBeenCalledTimes(1);
  });
});
