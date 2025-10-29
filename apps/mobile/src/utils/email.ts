export function sanitizeEmail(raw: string) {
  return raw
    ?.normalize('NFKC')
    .replace(/\s/g, '')
    .toLowerCase();
}

export function looksLikeEmail(e: string) {
  return typeof e === 'string' && e.includes('@') && e.includes('.');
}

// Sanity hints: looksLikeEmail('markuss@test.com') -> true, looksLikeEmail('a@b.co') -> true.
