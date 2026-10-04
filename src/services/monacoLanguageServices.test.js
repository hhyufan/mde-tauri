import { beforeEach, expect, it, vi } from 'vitest';
import useLspStore from '@store/useLspStore';
import { disableBundledLanguageServices, languageSuggestionOptions } from './monacoLanguageServices';

beforeEach(() => useLspStore.setState({ enabled: true, installed: [], catalog: [] }));

it('removes built-in semantic providers for plugin languages without disabling highlighting or external links', () => {
  const defaults = () => ({ modeConfiguration: { completionItems: true, hovers: true, diagnostics: true,
    definitions: true, signatureHelp: true, documentFormattingEdits: true, links: true }, setModeConfiguration: vi.fn() });
  const javascriptDefaults = { ...defaults(), getDiagnosticsOptions: () => ({}), setDiagnosticsOptions: vi.fn() };
  const services = { typescript: { javascriptDefaults, typescriptDefaults: defaults() }, html: { htmlDefaults: defaults() },
    css: { cssDefaults: defaults(), scssDefaults: defaults(), lessDefaults: defaults() }, json: { jsonDefaults: defaults() } };
  const monaco = { languages: { ...services, setTokensProvider: vi.fn() } };
  disableBundledLanguageServices(monaco);
  for (const service of [javascriptDefaults, services.typescript.typescriptDefaults, services.html.htmlDefaults,
    ...Object.values(services.css)]) {
    expect(service.setModeConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      completionItems: false, hovers: false, diagnostics: false, definitions: false, signatureHelp: false,
      documentFormattingEdits: false, links: true,
    }));
  }
  expect(javascriptDefaults.setDiagnosticsOptions).toHaveBeenCalledWith({
    noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true,
  });
  expect(services.json.jsonDefaults.setModeConfiguration).not.toHaveBeenCalled();
  expect(monaco.languages.setTokensProvider).not.toHaveBeenCalled();
  disableBundledLanguageServices(monaco);
  expect(javascriptDefaults.setModeConfiguration).toHaveBeenCalledTimes(1);
});

it('does not replace a removed plugin with document-word suggestions', () => {
  useLspStore.setState({ enabled: false });
  for (const language of ['javascript', 'typescript', 'html', 'css', 'python', 'kotlin', 'rust']) {
    expect(languageSuggestionOptions(language).wordBasedSuggestions).toBe('off');
  }
  expect(languageSuggestionOptions('plaintext').wordBasedSuggestions).toBe('currentDocument');
  useLspStore.setState({ catalog: [{ id: 'custom.zig', languages: ['zig'] }] });
  expect(languageSuggestionOptions('zig').wordBasedSuggestions).toBe('off');
});
