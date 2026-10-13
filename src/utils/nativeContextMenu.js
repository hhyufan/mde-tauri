// Cancel only the WebView's default menu. Do not stop propagation: Monaco and
// application controls still need to receive right-click events normally.
export function disableNativeContextMenu(target = document) {
  const preventDefaultMenu = (event) => event.preventDefault();
  target.addEventListener('contextmenu', preventDefaultMenu);
  return () => target.removeEventListener('contextmenu', preventDefaultMenu);
}
