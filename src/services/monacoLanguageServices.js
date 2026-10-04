import useLspStore, { availablePlugins } from '@store/useLspStore';
export { disableBundledLanguageServices } from '@/utils/monacoBuiltinServices';

/** Don't make document-word suggestions look like a still-running language service. */
export function languageSuggestionOptions(language) {
  const managed = availablePlugins(useLspStore.getState()).some((plugin) => plugin.languages.includes(language));
  return { wordBasedSuggestions: managed ? 'off' : 'currentDocument' };
}
