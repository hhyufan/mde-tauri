import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useConfigStore from '@store/useConfigStore';
import { readBackgroundImage } from '@utils/backgroundImage';
import { useBackgroundImage } from './useBackgroundImage';

vi.mock('@utils/backgroundImage', () => ({ readBackgroundImage: vi.fn() }));
const createUrl = vi.fn(() => 'blob:background');
const revokeUrl = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  useConfigStore.setState({ backgroundImage: '' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('loads a persisted image and releases its URL when the image is removed', async () => {
  readBackgroundImage.mockResolvedValue(new Blob(['image']));
  useConfigStore.setState({ backgroundImage: 'saved-image' });
  const { result } = renderHook(useBackgroundImage);
  await waitFor(() => expect(result.current.url).toBe('blob:background'));
  expect(readBackgroundImage).toHaveBeenCalledWith('saved-image');
  act(() => useConfigStore.setState({ backgroundImage: '' }));
  expect(result.current.url).toBeUndefined();
  expect(revokeUrl).toHaveBeenCalledWith('blob:background');
});

it('ignores a slow previous image after another image has been selected', async () => {
  let finish;
  readBackgroundImage.mockImplementation((id) => id === 'old'
    ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve(new Blob(['new'])));
  useConfigStore.setState({ backgroundImage: 'old' });
  const { result, unmount } = renderHook(useBackgroundImage);
  act(() => useConfigStore.setState({ backgroundImage: 'new' }));
  await waitFor(() => expect(result.current.id).toBe('new'));
  await act(async () => finish(new Blob(['old'])));
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(result.current.id).toBe('new');
  unmount();
  expect(revokeUrl).toHaveBeenCalledTimes(1);
});

it('leaves the regular workspace background available when an image is missing', async () => {
  readBackgroundImage.mockResolvedValue(undefined);
  useConfigStore.setState({ backgroundImage: 'missing' });
  const { result } = renderHook(useBackgroundImage);
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.url).toBeUndefined();
  expect(createUrl).not.toHaveBeenCalled();
});
