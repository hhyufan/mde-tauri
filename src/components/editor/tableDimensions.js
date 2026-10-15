export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 30;

export function tableDimensions(rows, columns) {
  rows = Number(rows); columns = Number(columns);
  return Number.isInteger(rows) && rows >= 1 && rows <= MAX_TABLE_ROWS
    && Number.isInteger(columns) && columns >= 1 && columns <= MAX_TABLE_COLUMNS
    ? { rows, columns } : null;
}

export function tableMarkdown(rows, columns) {
  if (!tableDimensions(rows, columns)) return '';
  const line = `|${'   |'.repeat(columns)}\n`;
  return line + `|${' --- |'.repeat(columns)}\n` + line.repeat(rows - 1);
}
