/**
 * 快捷键录入控件。
 *
 * 点击后进入「捕获」状态，接下来按下的一次组合键即被记录：
 *
 * - 只按修饰键不会结束捕获，否则用户按 Ctrl 的瞬间就会绑定上一个残缺键位。
 * - Escape 取消捕获，Backspace/Delete 清除绑定（表示禁用该动作）。
 * - 组合非法时给出原因提示并保持捕获状态，让用户直接重按，而不是退出重来。
 *
 * 布局上把重置按钮放在输入框**内部**：它作用于这个键位本身，放在框外会让人
 * 以为它属于整行。当键位已经等于默认值时不再渲染它——那时候没有可恢复的东西。
 *
 * 使用 `KeyboardEvent.code` 采集物理按键，因此与键盘布局无关，也不会因为按住
 * Shift 后 `key` 变成别的字符而录错——这正是 `Ctrl+Shift+/` 之前失效的根因。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { CloseCircleFilled } from '@ant-design/icons';
import {
  formatKeybinding,
  isModifierCode,
  keybindingFromEvent,
  validateKeybinding,
} from '@utils/keybinding';
import { beginShortcutCapture } from '@/configs/hotkeys';
import './shortcut-input.scss';

/**
 * 快捷键录入控件。
 *
 * @param {object} props 组件属性。
 * @param {string} props.value 当前归一化键位，空串表示未绑定。
 * @param {(keybinding: string) => void} props.onChange 录入完成后的回调。
 * @param {() => void} props.onReset 恢复默认键位。
 * @param {boolean} [props.isDefault] 当前是否已是默认键位。
 * @param {{tone: string, message: string}} [props.notice] 状态与说明。
 * @param {boolean} [props.disabled] 是否禁用。
 */
function ShortcutInput({ value, onChange, onReset, isDefault = false, notice, disabled = false }) {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState('');
  const fieldRef = useRef(null);
  const releaseCaptureRef = useRef(null);

  const stopCapture = useCallback(() => {
    setCapturing(false);
    setHint('');
    releaseCaptureRef.current?.();
    releaseCaptureRef.current = null;
  }, []);

  // 录入期间挂起全局快捷键（详见 configs/hotkeys 中的说明）。
  const startCapture = useCallback(() => {
    releaseCaptureRef.current?.();
    releaseCaptureRef.current = beginShortcutCapture();
    setCapturing(true);
    setHint('');
  }, []);

  // 组件卸载时务必归还挂起状态，否则全局快捷键会永久失效。
  useEffect(() => () => {
    releaseCaptureRef.current?.();
    releaseCaptureRef.current = null;
  }, []);

  /** 捕获期间处理按键。 */
  const handleKeyDown = useCallback((event) => {
    // 捕获期间必须阻止事件继续传播：否则按键会同时触发全局快捷键，
    // 用户按下 Ctrl+S 想改绑定时反而先保存了一次文件。
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      stopCapture();
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onChange('');
      stopCapture();
      return;
    }
    // 还在按修饰键，等待主键。
    if (isModifierCode(event.code)) {
      setHint(t('settings.shortcuts.keepPressing'));
      return;
    }

    const keybinding = keybindingFromEvent(event);
    const validation = validateKeybinding(keybinding);
    if (!validation.ok) {
      const reasons = {
        empty: 'keepPressing',
        modifierOnly: 'keepPressing',
        needsModifier: 'needsModifier',
        reserved: 'reserved',
      };
      setHint(t(`settings.shortcuts.hint.${reasons[validation.reason] ?? 'needsModifier'}`));
      return;
    }
    onChange(keybinding);
    stopCapture();
  }, [onChange, stopCapture, t]);

  // 捕获中点击别处即取消，避免控件停留在“等待按键”状态却无人察觉。
  useEffect(() => {
    if (!capturing) return undefined;
    const onClickOutside = (event) => {
      if (!fieldRef.current?.contains(event.target)) stopCapture();
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [capturing, stopCapture]);

  // 外部提示发生变化（例如刚被拒绝、或原生探测回滚了绑定）时退出录入态，
  // 让用户看到提示后能直接重新按键。依赖 notice.key 是因为 notice 本身
  // 每次渲染都是新对象，直接放进依赖会每帧触发。
  const noticeKey = notice?.key;
  useEffect(() => {
    if (noticeKey) stopCapture();
  }, [noticeKey, stopCapture]);

  const display = capturing
    ? (hint || t('settings.shortcuts.pressKeys'))
    : (formatKeybinding(value) || t('settings.shortcuts.unbound'));
  // 状态色落在快捷键本身：绿色=原生确认可用，黄色=可能被系统抢先，
  // 红色=确定不可用，中性=当前环境探测不到（刻意不冒充可用）。
  const status = capturing ? null : notice?.tone;
  const statusClass = status ? ` shortcut-input__kbd--${status}` : '';
  // 悬停重置按钮时，两个 tooltip 会互相打架：外层那个（状态说明）要主动让位。
  const [resetHovered, setResetHovered] = useState(false);

  return (
    <div className={`shortcut-input${capturing ? ' shortcut-input--capturing' : ''}`}>
      <Tooltip
        title={capturing || resetHovered ? null : notice?.message}
        placement="topRight"
      >
        <div
          ref={fieldRef}
          className="shortcut-input__field"
          onClick={() => (capturing ? stopCapture() : startCapture())}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label={t('settings.shortcuts.captureLabel')}
          aria-invalid={status === 'error' || undefined}
          aria-disabled={disabled || undefined}
          // 捕获时按键处理挂在容器上，和键盘焦点无关，用户鼠标点一下就能录。
          onKeyDown={capturing && !disabled ? handleKeyDown : undefined}
        >
          <kbd className={`shortcut-input__kbd${statusClass}`}>{display}</kbd>
          {/* 重置按钮在框内，只在键位与默认值不同时才出现：默认值没有可恢复的东西。 */}
          {!isDefault && !disabled && (
            <button
              type="button"
              className="shortcut-input__reset"
              onClick={(event) => {
                // 不能触发容器的开始录入。
                event.stopPropagation();
                stopCapture();
                onReset();
              }}
              onPointerEnter={() => setResetHovered(true)}
              onPointerLeave={() => setResetHovered(false)}
              onFocus={() => setResetHovered(true)}
              onBlur={() => setResetHovered(false)}
              aria-label={t('settings.shortcuts.resetAction')}
            >
              <CloseCircleFilled />
            </button>
          )}
        </div>
      </Tooltip>
      {/* 重置的 tooltip 锚在整个输入框上（而不是那个贴右的小按钮）：
          锚在按钮上时 topRight 对齐的是按钮右边缘，会越过设置面板被裁掉；
          锚在输入框上则与框右边缘对齐，方位与外层说明完全一致。 */}
      {!isDefault && !disabled && resetHovered && (
        <Tooltip
          title={t('settings.shortcuts.resetAction')}
          placement="topRight"
          open
          // 锚点铺满输入框，使提示与框右边缘对齐（不会越过设置面板被裁掉）。
          getPopupContainer={() => fieldRef.current ?? document.body}
          overlayClassName="shortcut-input__reset-tip"
        >
          <span className="shortcut-input__anchor" aria-hidden="true" />
        </Tooltip>
      )}
    </div>
  );
}

export default ShortcutInput;
