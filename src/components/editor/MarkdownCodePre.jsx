import CodeBlockExecution from './CodeBlockExecution';
import { getCodeBlockLanguage } from '@/services/scriptRunner';
import { codeBlockKey } from '@utils/markdownCodeBlocks';
import { isAndroidRuntime } from '@utils/platform';

export default function MarkdownCodePre({ children, node, documentId, filePath, fileName, ...props }) {
  const code = node?.children?.find((child) => child.tagName === 'code');
  const info = code?.properties?.className?.find((name) => name.startsWith('language-'))?.slice(9) || '';
  const language = getCodeBlockLanguage(info);
  const source = code?.children?.map((child) => child.value || '').join('').replace(/\n$/, '') || '';
  if (!language || isAndroidRuntime()) return <pre {...props}>{children}</pre>;
  return <div className="md-runnable-code"><pre {...props}>{children}</pre>
    <CodeBlockExecution blockKey={codeBlockKey(documentId, node.data.mdeBlockIndex)} language={language}
      source={source} filePath={filePath} fileName={fileName} />
  </div>;
}
