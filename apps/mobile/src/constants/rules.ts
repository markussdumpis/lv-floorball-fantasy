type Translate = (key: string) => string;

export function getGameRules(t: Translate) {
  return [
    { label: t('rules.captainLabel'), value: t('rules.captainValue') },
    { label: t('rules.transfersLabel'), value: t('rules.transfersValue') },
    { label: t('rules.gameweeksLabel'), value: t('rules.gameweeksValue') },
    { label: t('rules.locksLabel'), value: t('rules.locksValue') },
  ];
}
