import { parseFootnotes } from '../utils/footnoteParser';
import { extractItems } from '../utils/markdownOutline';

self.onmessage = ({ data: { id, content = '' } }) => {
  self.postMessage({ id, result: {
    footnotes: parseFootnotes(content).content,
    outline: extractItems(content),
  } });
};