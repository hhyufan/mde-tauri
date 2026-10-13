import { useEffect, useMemo, useState } from 'react';
import { markdownAnalysis } from '@/services/markdownAnalysis';
import { parseFootnotes } from '@utils/footnoteParser';
import { extractItems } from '@utils/markdownOutline';

const EMPTY_ITEMS = [];
function analyze(content, type) {
  return type === 'outline' ? extractItems(content) : parseFootnotes(content).content;
}

export function useMarkdownAnalysis(documentId, content, type) {
  const large = content.length > 200000;
  const [snapshot, setSnapshot] = useState(null);
  const inline = useMemo(() => large ? null : analyze(content, type), [content, large, type]);
  useEffect(() => {
    if (!large) return undefined;
    let cancelled = false;
    markdownAnalysis.analyze(documentId, content).then((result) => {
      if (!cancelled && result) setSnapshot({ documentId, content, result: result[type] });
    }).catch((error) => {
      if (cancelled) return;
      console.warn('[Markdown] Background analysis unavailable:', error);
      setSnapshot({ documentId, content, result: analyze(content, type) });
    });
    return () => { cancelled = true; };
  }, [documentId, content, large, type]);
  const currentDocument = snapshot?.documentId === documentId;
  return {
    // Keep this document's previous preview while analyzing; never render raw
    // large text first or expose another document's delayed result.
    value: large ? (currentDocument ? snapshot.result : type === 'outline' ? EMPTY_ITEMS : '') : inline,
    pending: large && (!currentDocument || snapshot.content !== content),
  };
}
