import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import useEditorStore from '@store/useEditorStore';
import { getDirectoryContents } from '@utils/tauriApi';
import i18n from '@/i18n';
import Footer from './Footer';

globalThis.React = React;
const openFile = vi.hoisted(() => vi.fn());
vi.mock('@hooks/useFileManager', () => ({ useFileManager: () => ({ openFileFromPath: openFile }) }));
vi.mock('@components/ui/SyncStatusIndicator', () => ({ default: () => <span>sync</span> }));
vi.mock('@components/ui/FileTypeIcon', () => ({ default: () => <span>icon</span> }));
vi.mock('@utils/tauriApi', () => ({
  getDirectoryContents: vi.fn(), isSafUri: () => false, safDisplayName: () => '', showInExplorer: vi.fn(),
}));

beforeEach(() => {
  i18n.changeLanguage('zh');
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useEditorStore.setState({
    activeTabId: 'file', viewMode: 'edit',
    tabRenderList: [{ id: 'file', name: 'note.md', ext: 'md', path: 'C:\\Notes\\note.md' }],
  });
  getDirectoryContents.mockResolvedValue([{ name: 'other.md', path: 'C:\\Notes\\other.md', ext: 'md' }]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('footer breadcrumb triggers', () => {
  it('opens paths and tooltips in StrictMode without findDOMNode warnings', async () => {
    const warnings = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<React.StrictMode><Footer /></React.StrictMode>);
    const segment = screen.getByText('Notes');
    fireEvent.mouseOver(segment);
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent('C:\\Notes'), { timeout: 1500 });
    fireEvent.mouseOut(segment);
    fireEvent.click(segment);
    await waitFor(() => expect(screen.getByText('other.md')).toBeVisible());
    fireEvent.click(screen.getByText('other.md'));
    expect(openFile).toHaveBeenCalledWith('C:\\Notes\\other.md', 'other.md');
    expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/findDOMNode|Maximum update depth|does not support refs/);
  });
});
