// Accept external links without turning relative Markdown paths into web URLs.
export function externalLink(value) {
  const text = String(value || '').trim();
  if (!/^(https?:|mailto:)/i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'mailto:' || url.hostname ? url.href : null;
  } catch { return null; }
}
