import {
  cloneElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Image, Input, Tooltip } from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  LinkOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { TextSelection } from '@milkdown/kit/prose/state';
import { closeHistory } from '@milkdown/kit/prose/history';
import { loadMarkdownImageSrc } from '@utils/markdownAssets';
import useEditorStore from '@store/useEditorStore';
import {
  mediaAt,
  imageDescription,
  validMediaAddress,
  applyMediaEdit,
  mediaEditorKey,
} from './milkdownMedia';
import './milkdown-media.scss';

const MilkdownMediaTools = forwardRef(function MilkdownMediaTools(
  { rootRef, getView, ready, readOnly },
  ref,
) {
  const { t } = useTranslation();
  const [surface, setSurface] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewEdit, setPreviewEdit] = useState(null);
  const current = useRef(null);
  const inputRef = useRef(null);
  const pickerOpen = useRef(false);
  const applying = useRef(false);
  useEffect(
    () => () => {
      if (preview?.objectUrl) URL.revokeObjectURL(preview.objectUrl);
    },
    [preview?.objectUrl],
  );
  const update = useCallback((value) => {
    current.current = value;
    setSurface(value);
  }, []);
  const clear = useCallback((focus = false) => {
    const value = current.current;
    current.current = null;
    setSurface(null);
    setError('');
    if (!value || value.view.isDestroyed) return;
    value.view.dispatch(value.view.state.tr.setMeta(mediaEditorKey, null));
    if (focus) value.view.focus();
  }, []);
  const commit = useCallback(
    (value = current.current, finish = false) => {
      if (applying.current) return true;
      applying.current = true;
      try {
        if (!value) return true;
        if (!value.dirty && (!finish || value.node || value.mark)) {
          if (finish) clear(true);
          return true;
        }
        if (!validMediaAddress(value.address, value.kind)) {
          setError(t('media.invalidAddress'));
          return false;
        }
        const view = value.view;
        if (view.isDestroyed || !view.state.doc.eq(value.doc)) {
          setError(t('media.changed'));
          return false;
        }
        view.dispatch(closeHistory(view.state.tr).setMeta(mediaEditorKey, null));
        applyMediaEdit(view, value, value, t('media.imageFallback'));
        view.dispatch(closeHistory(view.state.tr));
        if (finish) {
          clear(true);
          return true;
        }
        const target = mediaAt(view, value.from, value.kind);
        if (!target) {
          clear();
          return true;
        }
        const next = { ...value, ...target, doc: view.state.doc, dirty: false };
        view.dispatch(
          view.state.tr.setMeta(mediaEditorKey, {
            position: target.from,
            dom: value.dom,
            from: target.from,
            to: target.to,
            kind: target.kind,
          }),
        );
        update(next);
        setError('');
        return true;
      } finally {
        applying.current = false;
      }
    },
    [clear, t, update],
  );
  const show = useCallback(
    (kind, target, focus = false, element) => {
      if (readOnly) return;
      const view = getView();
      if (!view) return;

      const previous = current.current;
      if (
        previous &&
        target &&
        previous.from === target.from &&
        previous.kind === kind &&
        previous.dom.isConnected
      ) {
        if (focus) inputRef.current?.focus();
        return;
      }
      if (previous && !commit(previous)) return;
      const selection = view.state.selection;
      const dom = document.createElement('span');
      dom.className = 'milkdown-media-inline';
      dom.contentEditable = 'false';
      const value = {
        ...(target || {
          kind,
          from: selection.from,
          to: selection.to,
          address: '',
          text: kind === 'link' ? view.state.doc.textBetween(selection.from, selection.to) : '',
        }),
        doc: view.state.doc,
        selection,
        view,
        dom,
        element,
        dirty: false,
        focus,
      };
      view.dispatch(
        view.state.tr.setMeta(mediaEditorKey, {
          position: value.from,
          dom,
          from: target?.from ?? value.from,
          to: target?.to ?? value.from,
          kind,
        }),
      );
      update(value);
      setError('');
    },
    [readOnly, getView, commit, update],
  );
  useImperativeHandle(
    ref,
    () => ({
      open(kind) {
        const view = getView();
        if (view) show(kind, mediaAt(view, view.state.selection.from, kind), true);
      },
    }),
    [getView, show],
  );
  useEffect(() => {
    if (!surface?.focus) return undefined;
    const frame = requestAnimationFrame(() => {
      surface.dom.scrollIntoView({ block: 'nearest' });
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [surface?.dom, surface?.focus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!ready || !root) return undefined;
    const contextMenu = (event) => {
      if (readOnly || event.target.closest?.('.milkdown-media-inline')) return;
      const element = event.target.closest?.('a, img[src], [data-moki-empty-image]');
      const view = getView();
      if (!view || !element || !view.dom.contains(element)) return;
      try {
        const kind = element.matches('img, [data-moki-empty-image]') ? 'image' : 'link';
        const target = mediaAt(view, view.posAtDOM(element, 0), kind);
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          show(kind, target, true, element);
        }
      } catch {
        /* Input rules may replace the DOM during pointer movement. */
      }
    };
    const click = (event) => {
      const image = event.target.closest?.('img[src], [data-moki-empty-image]');
      const view = getView();
      if (!image || !view?.dom.contains(image)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (!image.getAttribute('src')) {
        return;
      }
      if (!commit()) return;
      clear();
      setPreviewEdit(null);
      setPreview({
        src: image.currentSrc || image.src,
        alt: image.alt,
        target: mediaAt(view, view.posAtDOM(image, 0), 'image'),
        doc: view.state.doc,
        view,
      });
    };
    const keydown = (event) => {
      if (event.target.closest?.('.milkdown-media-inline')) {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          event.stopPropagation();
          commit(current.current, true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          clear(true);
        }
        return;
      }
      if (readOnly) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        const view = getView();
        show('link', mediaAt(view, view.state.selection.from, 'link'), true);
      }
      if (event.key === 'Escape') clear();
    };
    const outside = (event) => {
      const value = current.current;
      if (!value || pickerOpen.current || value.dom.contains(event.target)) return;
      if (event.target.closest?.('a, img[src], [data-moki-empty-image]')) return;
      if (commit(value)) clear();
    };
    root.addEventListener('contextmenu', contextMenu, true);
    root.addEventListener('click', click, true);
    root.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      root.removeEventListener('contextmenu', contextMenu, true);
      root.removeEventListener('click', click, true);
      root.removeEventListener('keydown', keydown, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [ready, rootRef, getView, readOnly, show, clear, commit]);
  const change = (patch) => {
    update({ ...current.current, ...patch, dirty: true });
    setError('');
  };
  const chooseFile = async () => {
    const value = current.current;
    pickerOpen.current = true;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const file = await open({
        multiple: false,
        filters: [
          {
            name: t('media.image'),
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'],
          },
        ],
      });
      if (file && current.current?.dom === value.dom)
        commit({ ...current.current, address: file, dirty: true });
    } catch {
      setError(t('media.fileError'));
    } finally {
      pickerOpen.current = false;
    }
  };
  const remove = () => {
    const value = current.current;
    if (!value) return;
    const { view } = value;
    if (!view.state.doc.eq(value.doc)) {
      clear();
      return;
    }
    if (value.node || value.mark) {
      const tr = closeHistory(view.state.tr).setMeta(mediaEditorKey, null);
      if (value.kind === 'image') tr.delete(value.from, value.to);
      else tr.removeMark(value.from, value.to, view.state.schema.marks.link);
      tr.setSelection(TextSelection.near(tr.doc.resolve(value.from)));
      view.dispatch(tr);
      view.dispatch(closeHistory(view.state.tr));
    }
    clear(true);
  };
  const savePreview = async (edit = previewEdit) => {
    const value = preview;
    if (!value?.target || !edit) return;
    if (value.view.isDestroyed || !value.view.state.doc.eq(value.doc)) {
      setPreviewEdit({ ...edit, error: t('media.changed') });
      return;
    }
    const address = edit.field === 'address' ? edit.value : value.target.address;
    if (!validMediaAddress(address, 'image')) {
      setPreviewEdit({ ...edit, error: t('media.invalidAddress') });
      return;
    }
    value.view.dispatch(closeHistory(value.view.state.tr));
    applyMediaEdit(
      value.view,
      value.target,
      { address, text: edit.field === 'text' ? edit.value : value.target.text },
      t('media.imageFallback'),
    );
    value.view.dispatch(closeHistory(value.view.state.tr));
    const target = mediaAt(value.view, value.target.from, 'image');
    const next = { ...value, target, doc: value.view.state.doc, alt: target.text };
    setPreview(next);
    setPreviewEdit(null);
    if (address !== value.target.address) {
      const store = useEditorStore.getState();
      const path = store.tabs.find((tab) => tab.id === store.activeTabId)?.path || '';
      const result = await loadMarkdownImageSrc(address, path);
      setPreview((active) => {
        if (active?.doc !== next.doc) {
          if (result.objectUrl) URL.revokeObjectURL(result.objectUrl);
          return active;
        }
        return { ...active, src: result.src, objectUrl: result.objectUrl };
      });
    }
  };
  const choosePreviewFile = async () => {
    pickerOpen.current = true;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const file = await open({
        multiple: false,
        filters: [
          {
            name: t('media.image'),
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'],
          },
        ],
      });
      if (file) await savePreview({ field: 'address', value: file });
    } catch {
      setPreviewEdit((edit) => (edit ? { ...edit, error: t('media.fileError') } : edit));
    } finally {
      pickerOpen.current = false;
    }
  };
  return (
    <>
      {surface &&
        createPortal(
          <form
            className="milkdown-media-tools milkdown-media-form"
            role="toolbar"
            aria-label={t(`media.${surface.kind}`)}
            onSubmit={(event) => {
              event.preventDefault();
              commit(current.current, true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                clear(true);
              }
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commit(current.current, true);
              }
            }}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                !pickerOpen.current &&
                current.current?.dirty
              )
                commit();
            }}
          >
            <span className="milkdown-media-tools__icon">
              {surface.kind === 'image' ? <PictureOutlined /> : <LinkOutlined />}
            </span>
            <Input
              id="milkdown-media-text"
              size="small"
              variant="borderless"
              value={surface.text}
              aria-label={t(surface.kind === 'image' ? 'media.description' : 'media.linkText')}
              placeholder={
                surface.kind === 'image'
                  ? imageDescription(surface.address, t('media.autoDescription'))
                  : t('media.linkText')
              }
              onChange={(event) => change({ text: event.target.value })}
            />
            <Input
              ref={inputRef}
              id="milkdown-media-address"
              size="small"
              variant="borderless"
              value={surface.address}
              status={error ? 'error' : undefined}
              aria-label={t(surface.kind === 'image' ? 'media.imageAddress' : 'media.linkAddress')}
              placeholder={t('media.addressPlaceholder')}
              title={surface.address}
              onChange={(event) => change({ address: event.target.value })}
            />
            {surface.kind === 'image' && (
              <Tooltip title={t('media.chooseFile')}>
                <button
                  type="button"
                  aria-label={t('media.chooseFile')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={chooseFile}
                >
                  <PictureOutlined />
                </button>
              </Tooltip>
            )}
            <Tooltip title={t(surface.kind === 'image' ? 'media.remove' : 'media.unlink')}>
              <button
                type="button"
                aria-label={t(surface.kind === 'image' ? 'media.remove' : 'media.unlink')}
                onMouseDown={(event) => event.preventDefault()}
                onClick={remove}
              >
                {surface.kind === 'image' ? <DeleteOutlined /> : <DisconnectOutlined />}
              </button>
            </Tooltip>
            <button type="submit" hidden />
            {error && (
              <span className="milkdown-media-tools__error" role="alert">
                {error}
              </span>
            )}
          </form>,
          surface.dom,
        )}
      {preview && (
        <Image
          style={{ display: 'none' }}
          src={preview.src}
          alt={preview.alt}
          preview={{
            visible: true,
            onVisibleChange: (visible) => {
              if (!visible) {
                setPreview(null);
                setPreviewEdit(null);
              }
            },
            toolbarRender: (original) =>
              cloneElement(
                original,
                { className: `${original.props.className} milkdown-media-preview-toolbar` },
                original.props.children,
                !readOnly && preview.target && (
                  <div
                    className="milkdown-media-preview-tools"
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <Tooltip title={t('media.editDescription')}>
                      <button
                        type="button"
                        aria-label={t('media.editDescription')}
                        onClick={() =>
                          setPreviewEdit({ field: 'text', value: preview.target.text })
                        }
                      >
                        <EditOutlined />
                      </button>
                    </Tooltip>
                    <Tooltip title={t('media.editSource')}>
                      <button
                        type="button"
                        aria-label={t('media.editSource')}
                        onClick={() =>
                          setPreviewEdit({ field: 'address', value: preview.target.address })
                        }
                      >
                        <PictureOutlined />
                      </button>
                    </Tooltip>
                    {previewEdit && (
                      <div className="milkdown-media-preview-editor">
                        <Input
                          autoFocus
                          aria-label={t(
                            previewEdit.field === 'text'
                              ? 'media.description'
                              : 'media.imageAddress',
                          )}
                          value={previewEdit.value}
                          onChange={(event) =>
                            setPreviewEdit({ ...previewEdit, value: event.target.value, error: '' })
                          }
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setPreviewEdit(null);
                            }
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                              event.preventDefault();
                              void savePreview();
                            }
                          }}
                        />
                        {previewEdit.field === 'address' && (
                          <Tooltip title={t('media.chooseFile')}>
                            <button
                              type="button"
                              aria-label={t('media.chooseFile')}
                              onClick={() => void choosePreviewFile()}
                            >
                              <PictureOutlined />
                            </button>
                          </Tooltip>
                        )}
                        <button
                          type="button"
                          aria-label={t('media.save')}
                          onClick={() => void savePreview()}
                        >
                          <CheckOutlined />
                        </button>
                        {previewEdit.error && <span role="alert">{previewEdit.error}</span>}
                      </div>
                    )}
                  </div>
                ),
              ),
          }}
        />
      )}
    </>
  );
});

export default MilkdownMediaTools;
