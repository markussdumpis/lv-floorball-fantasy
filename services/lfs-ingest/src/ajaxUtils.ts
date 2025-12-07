export function extractDataArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && typeof payload === 'object') {
    const candidates = ['data', 'aaData', 'rows', 'items', 'results'];
    for (const key of candidates) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [];
}

export function convertRowToRecord(
  row: unknown,
  headerTexts: string[],
): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  if (Array.isArray(row)) {
    const record: Record<string, unknown> = {};
    row.forEach((value, index) => {
      const header = headerTexts[index] ?? `col_${index}`;
      record[header] = value;
    });
    return record;
  }

  if (typeof row === 'object') {
    return row as Record<string, unknown>;
  }

  return null;
}

export function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return String(value);
}
