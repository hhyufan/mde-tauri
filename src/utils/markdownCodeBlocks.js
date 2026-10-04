export const codeBlockKey = (documentId, index) => JSON.stringify([documentId, 'code-block', index]);
export function rehypeCodeBlockIndexes() {
  return (tree) => {
    let index = 0;
    const visit = (node) => {
      if (node.tagName === 'pre') node.data = { ...node.data, mdeBlockIndex: index++ };
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
