import { beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import useUpdateStore from '@store/useUpdateStore';
import useLspStore from '@store/useLspStore';
import useTasks from './useTasks';

// 部分 mock：store 会 import @/i18n，它需要真实的 initReactI18next，
// 只替换 useTranslation。
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key }),
}));

const idle = {
  stage: 'idle',
  version: '',
  downloaded: 0,
  total: 0,
  error: '',
};

beforeEach(() => {
  useUpdateStore.setState(idle);
  useLspStore.setState({ operations: {} });
});

it('空闲时不列出任何任务，状态栏也没有可显示的任务', () => {
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(0);
  expect(result.current.active).toBeNull();
});

it('更新下载中：带确定百分比，并优先于语言服务占据状态栏', () => {
  useUpdateStore.setState({ stage: 'downloading', version: '0.1.4', downloaded: 512, total: 1024 });
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'extracting', percent: 90, text: '' } },
  });
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(2);

  const update = result.current.tasks.find((task) => task.kind === 'update');
  expect(update.percent).toBe(50);
  expect(update.showBar).toBe(true);
  expect(result.current.active).toBe(update);
});

it('更新没有总大小时不给确定百分比（圆环转圈），也不给关闭按钮', () => {
  useUpdateStore.setState({ stage: 'downloading', total: 0, downloaded: 123 });
  const { result } = renderHook(() => useTasks());
  expect(result.current.active.percent).toBeUndefined();
  expect(result.current.active.showBar).toBe(true);
  // 下载中止不了，不能给一个装作能关的按钮。
  expect(result.current.active.close).toBeNull();
});

it('语言服务安装中也会出现在任务里，并带上自己的百分比', () => {
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'downloading', percent: 30, text: '1.4 / 30.0 MB' } },
  });
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(1);
  expect(result.current.active).toMatchObject({
    kind: 'plugin',
    id: 'mde.marksman',
    stage: 'downloading',
    percent: 30,
    status: 'languageServices.phase.downloading',
    close: 'cancel',
  });
});

it('安装完成后（不在进行中也不失败）该任务消失', () => {
  useLspStore.setState({ operations: { 'mde.marksman': { phase: 'done' } } });
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(0);
});

it('没有进行中的任务时，退回"有可用更新"的提示', () => {
  useUpdateStore.setState({ stage: 'available', version: '0.1.4' });
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(1);
  expect(result.current.active.stage).toBe('available');
  expect(result.current.active.showBar).toBe(false);
  expect(result.current.active.close).toBe('reset');
});

it('语言服务的失败也留在任务里，便于看到原因', () => {
  useLspStore.setState({
    operations: { 'mde.marksman': { phase: 'error', text: 'download failed' } },
  });
  const { result } = renderHook(() => useTasks());
  expect(result.current.tasks).toHaveLength(1);
  expect(result.current.tasks[0].error).toBe('download failed');
  // 失败态不能说"安装"，那和报错自相矛盾；关闭方式也不是取消，而是把记录去掉。
  expect(result.current.tasks[0].status).toBe('tasks.pluginFailed');
  expect(result.current.tasks[0].close).toBe('dismiss');
  // 失败不算"进行中"，不占据状态栏的圆环位置
  expect(result.current.active).toBeNull();
});
