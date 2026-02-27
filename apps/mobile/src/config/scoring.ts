type Translate = (key: string) => string;

export function getScoringRules(t: Translate) {
  return [
    {
      title: t('rules.playersTitle'),
      rows: [
        { label: t('rules.goalAttacker'), value: '+1.5' },
        { label: t('rules.goalDefender'), value: '+2.0' },
        { label: t('rules.assistAttacker'), value: '+1.0' },
        { label: t('rules.assistDefender'), value: '+1.5' },
        { label: t('rules.hatTrick'), value: '+3' },
        { label: t('rules.mvp'), value: '+2' },
        { label: t('rules.penaltyScored'), value: '+0.5' },
        { label: t('rules.penaltyMissed'), value: '-0.5' },
        { label: t('rules.minorPenalty'), value: '-0.5' },
        { label: t('rules.doubleMinor'), value: '-2' },
        { label: t('rules.misconduct10'), value: '-3' },
        { label: t('rules.redCard'), value: '-6' },
      ],
    },
    {
      title: t('rules.goaliesTitle'),
      rows: [
        { label: t('rules.goalieAssist'), value: '+2' },
        { label: t('rules.save'), value: '+0.1' },
        { label: t('rules.goalsAgainst0'), value: '+8 (clean sheet in this band)' },
        { label: t('rules.goalsAgainst12'), value: '+5' },
        { label: t('rules.goalsAgainst35'), value: '+2' },
        { label: t('rules.goalsAgainst69'), value: '-2' },
        { label: t('rules.goalsAgainst10p'), value: '-5' },
        { label: t('rules.winBonus'), value: '+2' },
      ],
    },
  ];
}
