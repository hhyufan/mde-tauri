import apiClient from '../apiClient';
import {
  buildChangesParams,
  parseChangesPage,
  SYNC_CHANGE_PAGE_SIZE,
} from './changeProtocol';

/** The only module that knows the HTTP shape of the document sync protocol. */
export class SyncTransport {
  constructor(client = apiClient) {
    this.client = client;
  }

  async getConfig() {
    const { data } = await this.client.get('/sync/config');
    return data || {};
  }

  async putConfig(payload) {
    const { data } = await this.client.put('/sync/config', payload);
    return data;
  }

  async getChanges(checkpoint, limit = SYNC_CHANGE_PAGE_SIZE) {
    const { data } = await this.client.get('/sync/changes', {
      params: buildChangesParams(checkpoint, limit),
    });
    return parseChangesPage(data, checkpoint);
  }

  async getFile(fileId) {
    const { data } = await this.client.get(`/sync/file/${encodeURIComponent(fileId)}`);
    return data || null;
  }

  async putFile(fileId, payload) {
    const { data } = await this.client.put(
      `/sync/file/${encodeURIComponent(fileId)}`,
      payload,
    );
    return data || {};
  }

  async bindPath(fileId, payload) {
    const { data } = await this.client.post(
      `/sync/bindings/${encodeURIComponent(fileId)}`,
      payload,
    );
    return data || null;
  }

  async deleteFile(fileId, payload) {
    const { data } = await this.client.delete(
      `/sync/file/${encodeURIComponent(fileId)}`,
      { data: payload },
    );
    return data || {};
  }
}

export const syncTransport = new SyncTransport();
