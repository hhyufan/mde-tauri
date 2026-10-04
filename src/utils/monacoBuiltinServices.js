// Keep this runtime helper independent of application stores and React's entry.
const configured = new WeakSet();

/** Semantic features for marketplace languages come exclusively from their plugins. */
export function disableBundledLanguageServices(monaco) {
  const { typescript, html, css } = monaco.languages;
  const defaults = [typescript?.javascriptDefaults, typescript?.typescriptDefaults,
    html?.htmlDefaults, css?.cssDefaults, css?.scssDefaults, css?.lessDefaults];
  for (const service of defaults.filter(Boolean)) {
    if (configured.has(service)) continue;
    configured.add(service);
    // Keep HTML URL detection; Ctrl+click links does not require an installed LSP.
    service.setModeConfiguration(Object.fromEntries(Object.entries(service.modeConfiguration)
      .map(([feature, enabled]) => [feature, feature === 'links' && enabled])));
    if (service.getDiagnosticsOptions) service.setDiagnosticsOptions({ ...service.getDiagnosticsOptions(),
      noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
  }
}
