/**
 * 快捷键设置面板。
 *
 * 判断分三层，避免把“无法验证的事情”说成确定结论：
 *
 * 1. 本应用内部冲突：能准确判断，直接拒绝。
 * 2. 必然破坏输入的组合（Ctrl+C 等）：能确定，直接拒绝。
 * 3. 系统 / 浏览器接管的组合：桌面端向原生 `RegisterHotKey` 查询，能确认占用；
 *    浏览器 / macOS / Linux 探测不到时，只对已知清单给黄色提示，**绝不宣称可用**。
 *
 * 结果以三色（外加中性的“未验证”）落在快捷键本身：
 *   - 绿色 `ok`：原生已确认当前没有别的程序占用
 *   - 黄色 `warning`：该组合可能被系统抢先处理
 *   - 红色 `error`：确定不可用（应用内冲突，或已被别的程序占用）
 *   - 中性 `unknown`：当前环境探测不到，**未经验证**，不冒充可用
 * 细节说明走 tooltip，不再占一行文字。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty } from 'antd';
import useConfigStore from '@store/useConfigStore';
import {
  HOTKEY_ACTIONS,
  HOTKEY_GROUP_ORDER,
  findHotkeyConflicts,
  resolveHotkeys,
} from '@/configs/hotkeys';
import { validateKeybinding } from '@utils/keybinding';
import { probeHotkeyAvailability } from '@utils/hotkeyProbe';
import ShortcutInput from './ShortcutInput';
import './shortcuts-settings.scss';

/**
 * 快捷键设置面板。
 *
 * @param {object} props 组件属性。
 * @param {Function} [props.SettingGroup] 设置分组标题组件（由设置弹窗传入）。
 * @param {Function} [props.SettingRow] 设置行组件（由设置弹窗传入）。
 * @param {Function} [props.probe] 热键占用探测实现，默认走原生命令。
 *   留出注入点是为了能在浏览器里验证“系统已占用”这条路径——原生命令只在
 *   Tauri 环境存在，浏览器里永远返回 unsupported。
 */
function ShortcutsSettings({ SettingGroup, SettingRow, probe = probeHotkeyAvailability }) {
  const { t } = useTranslation();
  const stored = useConfigStore((state) => state.hotkeys);
  const setHotkey = useConfigStore((state) => state.setHotkey);
  const resetHotkeys = useConfigStore((state) => state.resetHotkeys);

  const hotkeys = useMemo(() => resolveHotkeys(stored), [stored]);
  const conflicts = useMemo(() => findHotkeyConflicts(hotkeys), [hotkeys]);
  // 阻止保存时的即时反馈：值没有变化，store 的冲突态不会体现出来，必须单独记。
  const [refusals, setRefusals] = useState({});
  // 每个动作最近一次的原生探测结论，决定快捷键显示绿/黄/红。
  const [availability, setAvailability] = useState({});
  // 探测是异步的，回调里读不到最新的键位表，因此用 ref 跟踪。
  const hotkeysRef = useRef(hotkeys);
  hotkeysRef.current = hotkeys;
  // 面板打开期间只做一轮全量探测，避免每次重渲染都打一批 IPC。
  const probedOnceRef = useRef(false);

  const actionName = useCallback((actionId) => {
    const action = HOTKEY_ACTIONS.find((item) => item.id === actionId);
    return action ? t(action.label) : actionId;
  }, [t]);

  /** 把已知的系统保留原因码翻成说明。 */
  const warningMessage = useCallback(
    (warning) => t(`settings.shortcuts.system.${warning}`),
    [t],
  );

  const refuse = useCallback((actionId, message, key) => {
    setRefusals((current) => ({ ...current, [actionId]: { message, key: `${actionId}:${key}` } }));
  }, []);

  const clearRefusal = useCallback((actionId) => {
    setRefusals((current) => {
      if (!(actionId in current)) return current;
      const next = { ...current };
      delete next[actionId];
      return next;
    });
  }, []);

  /** 记录一次探测结论，并挂到当前显示的键位上。 */
  const applyProbe = useCallback((actionId, keybinding, outcome) => {
    const warning = validateKeybinding(keybinding).warning;
    const statuses = {
      // 原生确认没被占用 → 绿色。
      available: { status: 'ok', message: t('settings.shortcuts.system.verified') },
      // 原生确认被占用 → 红色。
      taken: {
        status: 'error',
        message: t('settings.shortcuts.system.takenActual', { key: keybinding }),
      },
      // 探测不到：命中已知清单才算“可能被系统抢先”，否则只能是“未验证”。
      // 这里刻意不返回绿色——绿色表示“已确认可用”，而未知不能冒充已确认。
      unsupported: warning
        ? { status: 'warning', message: warningMessage(warning) }
        : { status: 'unknown', message: t('settings.shortcuts.system.unverified') },
    };
    const next = statuses[outcome?.status];
    if (!next) return;
    setAvailability((current) => ({ ...current, [actionId]: { keybinding, ...next } }));
  }, [t, warningMessage]);

  /** 探测一个键位；结果只在该动作仍绑着它时生效。 */
  const probeKeybinding = useCallback((actionId, keybinding) => {
    probe(keybinding).then((outcome) => {
      if (hotkeysRef.current[actionId] !== keybinding) return;
      applyProbe(actionId, keybinding, outcome);
    });
  }, [applyProbe, probe]);

  // 面板挂载后对已保存的键位各探测一次，让绿色/黄色/红色在一开始就准确。
  useEffect(() => {
    if (probedOnceRef.current) return;
    probedOnceRef.current = true;
    for (const action of HOTKEY_ACTIONS) {
      const keybinding = hotkeysRef.current[action.id];
      if (keybinding) probeKeybinding(action.id, keybinding);
    }
  }, [probeKeybinding]);

  /**
   * 计算某一行要展示的状态。
   *
   * 优先级：即时拒绝 → 应用内冲突 → 探测结论 → 已知系统清单。
   *
   * @param {object} action 快捷键动作定义。
   * @returns {{tone: string, message?: string, key: string}|undefined} 状态描述。
   */
  const statusOf = useCallback((action) => {
    const refusal = refusals[action.id];
    if (refusal) {
      return { tone: 'error', message: refusal.message, key: `${action.id}:refused:${refusal.key}` };
    }

    const keybinding = hotkeys[action.id];
    if (!keybinding) {
      return { tone: 'unknown', message: t('settings.shortcuts.unbound'), key: `${action.id}:unbound` };
    }

    const others = conflicts.get(keybinding)?.filter((id) => id !== action.id) ?? [];
    if (others.length > 0) {
      return {
        tone: 'error',
        message: t('settings.shortcuts.conflictInline', { action: actionName(others[0]) }),
        key: `${action.id}:conflict:${keybinding}`,
      };
    }

    const probed = availability[action.id];
    if (probed?.keybinding === keybinding) {
      return {
        tone: probed.status,
        message: probed.message ?? t('settings.shortcuts.system.verified'),
        key: `${action.id}:probed:${keybinding}:${probed.status}`,
      };
    }

    const warning = validateKeybinding(keybinding).warning;
    if (warning) {
      return { tone: 'warning', message: warningMessage(warning), key: `${action.id}:known:${keybinding}` };
    }
    // 还没探测出结论时立刻按中性处理，颜色类必须始终存在：否则探测完成前这些
    // 快捷键会继承默认黑色，同一面板里有的绿有的黑，看起来像坏了。
    return { tone: 'unknown', message: t('settings.shortcuts.tip'), key: `${action.id}:plain:${keybinding}` };
  }, [actionName, availability, conflicts, hotkeys, refusals, t, warningMessage]);

  /**
   * 写入一个键位，并异步用原生探测确认真实占用情况。
   *
   * 原生确认被别的程序占用时，保存后立刻回滚并标红——这是确定结论，
   * 不能把一个按不动的组合留在配置里。
   *
   * @param {string} actionId 动作标识。
   * @param {string} keybinding 归一化键位。
   */
  const handleChange = (actionId, keybinding) => {
    const previous = hotkeysRef.current[actionId] ?? '';
    const result = setHotkey(actionId, keybinding);
    if (!result.ok) {
      const messages = {
        conflict: t('settings.shortcuts.conflictInline', { action: actionName(result.conflictWith) }),
        needsModifier: t('settings.shortcuts.hint.needsModifier'),
        reserved: t('settings.shortcuts.hint.reserved'),
        modifierOnly: t('settings.shortcuts.hint.modifierOnly'),
        empty: t('settings.shortcuts.hint.empty'),
        unknownAction: t('settings.shortcuts.hint.unknownAction'),
      };
      refuse(actionId, messages[result.reason] ?? messages.needsModifier,
        `refused:${result.reason}:${keybinding}`);
      return;
    }
    clearRefusal(actionId);
    setAvailability((current) => {
      const next = { ...current };
      delete next[actionId];
      return next;
    });
    if (keybinding === '' || keybinding === previous) return;

    probe(keybinding).then((outcome) => {
      // 用户可能已经换了别的绑定，此时旧的探测结论不再适用。
      if (hotkeysRef.current[actionId] !== keybinding) return;
      if (outcome.status === 'taken') {
        // 回滚：先清空再写回原值，否则新值本身会被判为冲突而清不掉。
        setHotkey(actionId, '');
        if (previous) setHotkey(actionId, previous);
        refuse(actionId, t('settings.shortcuts.system.takenActual', { key: keybinding }),
          `taken:${keybinding}`);
        return;
      }
      applyProbe(actionId, keybinding, outcome);
    });
  };

  const isDefaultAll = HOTKEY_ACTIONS.every(
    (action) => hotkeys[action.id] === action.defaultKeybinding,
  );

  const groups = HOTKEY_GROUP_ORDER
    .map((group) => ({
      group,
      actions: HOTKEY_ACTIONS.filter((action) => action.group === group),
    }))
    .filter((entry) => entry.actions.length > 0);

  return (
    <div className="settings-section shortcuts-settings">
      <div className="shortcuts-settings__header">
        <p className="shortcuts-settings__intro">{t('settings.shortcuts.intro')}</p>
        <Button
          size="small"
          onClick={() => {
            setRefusals({});
            setAvailability({});
            resetHotkeys();
          }}
          disabled={isDefaultAll}
        >
          {t('settings.shortcuts.resetAll')}
        </Button>
      </div>

      {groups.length === 0 && <Empty description={t('settings.shortcuts.empty')} />}

      {groups.map(({ group, actions }) => (
        <div key={group}>
          <SettingGroup label={t(`settings.shortcuts.group.${group}`)} />
          {actions.map((action) => {
            const status = statusOf(action);
            return (
              <SettingRow key={action.id} label={t(action.label)}>
                <ShortcutInput
                  value={hotkeys[action.id]}
                  isDefault={hotkeys[action.id] === action.defaultKeybinding}
                  notice={status}
                  onChange={(keybinding) => handleChange(action.id, keybinding)}
                  onReset={() => handleChange(action.id, action.defaultKeybinding)}
                />
              </SettingRow>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default ShortcutsSettings;
