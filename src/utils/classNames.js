/**
 * 轻量 className 拼接工具。
 *
 * 过滤掉假值后按空格连接，适合替代简单场景下的 `clsx`/`classnames`。
 */
/**
 * ?????????????? className ????
 */
export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}
