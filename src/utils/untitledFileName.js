import i18n from '@/i18n';

export function untitledFileName(index = 1) {
  const name = i18n.t('file.untitledName');
  return index === 1 ? name : `${name.slice(0, -3)} (${index}).md`;
}
