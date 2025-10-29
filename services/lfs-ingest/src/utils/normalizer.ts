export function normalizeName(raw: string): string {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '';
  const ascii = trimmed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ascii.replace(/\s+/g, ' ');
}

export function teamCode(name: string): string {
  const normalized = normalizeName(name);
  if (!normalized) return '';
  const compact = normalized.replace(/[^a-z0-9]+/gi, '').toUpperCase();
  if (compact.length >= 3) {
    return compact.slice(0, 3);
  }
  return normalized
    .split(' ')
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
    .padEnd(3, 'X');
}
