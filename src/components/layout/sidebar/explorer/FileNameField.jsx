/**
 * @file 文件名输入行：文件名输入框 + 紧跟文字的后缀下拉。
 *
 * 新建文件与行内重命名共用这一套——两处的交互应当完全一致，所以抽成组件，
 * 而不是在 FileTree 里各写一份。
 *
 * 输入区宽度保持固定，后缀浮在文字末尾，输入时不改变整行布局。
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { AutoComplete } from 'antd';
import { isImeComposing } from '@utils/keyboard';
import '@/assets/styles/rename-input.scss';

/** 常用后缀。下拉可编辑，用户可以挑一个，也可以直接敲自定义后缀。 */
export const FILE_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.json', '.yml', '.yaml', '.toml', '.ini',
  '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.vue',
  '.py', '.rs', '.go', '.java', '.cs', '.sh', '.bat', '.ps1',
  '.csv', '.xml', '.log',
];

/** 新建文件的默认后缀：绝大多数场景就是写 Markdown。 */
export const DEFAULT_FILE_EXTENSION = '.md';

/**
 * 把完整文件名拆成「主名 + 后缀」。
 *
 * 只看最后一个点：`.gitignore` 这类以点开头的名字没有后缀，
 * 否则会被拆出一个空主名。
 *
 * @param {string} fileName 完整文件名。
 * @returns {{stem: string, extension: string}} 主名与后缀（后缀含点，可为空串）。
 */
export function splitFileName(fileName = '') {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return { stem: fileName, extension: '' };
  return { stem: fileName.slice(0, dot), extension: fileName.slice(dot) };
}

/**
 * 文件名输入行。
 *
 * @param {object} props 组件属性。
 * @param {string} props.stem 主名（不含后缀）。
 * @param {string} props.extension 后缀（含点，可为空）。
 * @param {(stem: string) => void} props.onStemChange 主名变化回调。
 * @param {(extension: string) => void} props.onExtensionChange 后缀变化回调。
 * @param {() => void} props.onCommit 提交（回车或失焦）。
 * @param {() => void} props.onCancel 取消（Esc）。
 * @param {string} [props.placeholder] 占位文案。
 * @param {boolean} [props.autoFocus] 挂载时是否聚焦并全选输入框。
 * @param {React.RefObject<HTMLInputElement>} [props.inputRef] 外部持有的输入框引用。
 * @returns {JSX.Element} 输入行。
 */
export default function FileNameField({
  stem,
  extension,
  onStemChange,
  onExtensionChange,
  onCommit,
  onCancel,
  placeholder,
  autoFocus = false,
  inputRef: externalRef,
}) {
  const fieldRef = useRef(null);
  const nameMeasureRef = useRef(null);
  const extMeasureRef = useRef(null);
  useLayoutEffect(() => {
    const field = fieldRef.current, name = nameMeasureRef.current, ext = extMeasureRef.current;
    const measure = () => {
      const extWidth = Math.min(field.clientWidth, ext.getBoundingClientRect().width + 12);
      const left = Math.min(name.getBoundingClientRect().width + 1, Math.max(0, field.clientWidth - extWidth));
      field.style.setProperty('--filename-extension-left', `${left}px`);
      field.style.setProperty('--filename-extension-width', `${extWidth}px`);
      field.style.setProperty('--filename-extension-space', `${field.clientWidth - left}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(field); observer.observe(name); observer.observe(ext);
    return () => observer.disconnect();
  }, [stem, extension, placeholder]);
  const innerInputRef = useRef(null);
  const inputRef = externalRef || innerInputRef;
  // 后缀下拉的展开态：输入框的 onBlur 会先于下拉点击触发，靠它区分
  // 「用户去挑后缀」和「用户真的离开了」。
  const dropdownOpenRef = useRef(false);
  /**
   * 挂载后聚焦并全选。
   *
   * 输入框里只有主名（后缀是独立控件），所以全选就等于只选中文件名、
   * 不会碰后缀——重命名时直接打字是改名，跟资源管理器一致。
   *
   * @returns {void}
   */
  useEffect(() => {
    if (!autoFocus) return;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
  }, [autoFocus, inputRef]);

  /**
   * 输入框失焦：延后一拍再判断焦点是否落进了后缀下拉。
   *
   * 点后缀下拉会让输入框先失焦，若立刻提交，用户还没挑完后缀就提交了。
   *
   * @returns {void}
   */
  const handleBlur = useCallback(() => {
    window.setTimeout(() => {
      if (dropdownOpenRef.current) return;
      onCommit();
    }, 120);
  }, [onCommit]);

  return (
    <div className="file-tree__name-field" ref={fieldRef}>
      <span className="file-tree__name-measure" ref={nameMeasureRef} aria-hidden="true">{stem || placeholder}</span>
      <span className="file-tree__name-measure file-tree__extension-measure" ref={extMeasureRef} aria-hidden="true">{extension}</span>
      <input
        ref={inputRef}
        className="moki-rename-input file-tree__item-input file-tree__name-input"
        value={stem}
        onChange={(e) => onStemChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          e.stopPropagation();
          // 输入法组合期间回车是上屏候选词，不能当成提交，
          // 否则用拼音输入中文时会在半途就提交拼音文件名。
          if (isImeComposing(e)) return;
          if (e.key === 'Enter') { e.preventDefault(); onCommit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        placeholder={placeholder}
      />
      <div className="file-tree__ext-picker">
        <AutoComplete
          className="file-tree__ext-select"
          variant="borderless"
          size="small"
          value={extension}
          options={FILE_EXTENSIONS.map((extension) => ({ value: extension, label: <span>{extension}</span> }))}
          onChange={(value) => onExtensionChange(value ?? '')}
          onDropdownVisibleChange={(open) => { dropdownOpenRef.current = open; }}
          onBlur={() => { dropdownOpenRef.current = false; }}
          popupMatchSelectWidth={false}
          /*
           * 后缀框里光标已到最左时再按左键，退回文件名末尾。
           * 这两个框在用户眼里是一个输入框（note.md），不接这一段的话
           * 光标会卡在后缀开头，按左键毫无反应。
           */
          onInputKeyDown={(event) => {
            const el = event.target;
            if (event.key !== 'ArrowLeft' || el.selectionStart !== 0 || el.selectionEnd !== 0) return;
            event.preventDefault();
            const nameInput = inputRef.current;
            if (!nameInput) return;
            nameInput.focus();
            const end = nameInput.value.length;
            nameInput.setSelectionRange(end, end);
          }}
        />
      </div>
    </div>
  );
}
