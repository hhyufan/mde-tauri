import * as ReactRuntime from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import useAuthStore from '@store/useAuthStore';
import useConfigStore from '@store/useConfigStore';
import i18n from '@/i18n';
import SyncStatusIndicator from './SyncStatusIndicator';

globalThis.React = ReactRuntime;

describe('SyncStatusIndicator', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the footer control visible and marks it offline when signed out', () => {
    useAuthStore.setState({
      user: null,
      token: null,
      isLoggedIn: false,
      loading: false,
    });
    useConfigStore.setState({ syncEnabled: true });

    const { container } = render(<SyncStatusIndicator />);

    const indicator = container.querySelector('.sync-status--offline');
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent(i18n.t('sync.status.offline'));
  });
});
