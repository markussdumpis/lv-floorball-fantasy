export const SCORING_RULES = [
  {
    title: 'Players',
    rows: [
      { label: 'Goal (Attacker)', value: '+1.5' },
      { label: 'Goal (Defender)', value: '+2.0' },
      { label: 'Assist (Attacker)', value: '+1.0' },
      { label: 'Assist (Defender)', value: '+1.5' },
      { label: 'Hat-trick (3+ goals)', value: '+3' },
      { label: 'MVP', value: '+2' },
      { label: 'Penalty shot scored', value: '+0.5' },
      { label: 'Penalty shot missed', value: '-0.5' },
      { label: 'Minor penalty', value: '-0.5' },
      { label: 'Double minor', value: '-2' },
      { label: 'Misconduct 10', value: '-3' },
      { label: 'Red card', value: '-6' },
    ],
  },
  {
    title: 'Goalies',
    rows: [
      { label: 'Goal', value: '+2' },
      { label: 'Assist', value: '+2' },
      { label: 'Save', value: '+0.1' },
      { label: 'Goals against: 0', value: '+8 (clean sheet in this band)' },
      { label: 'Goals against: 1-2', value: '+5' },
      { label: 'Goals against: 3-5', value: '+2' },
      { label: 'Goals against: 6-9', value: '-2' },
      { label: 'Goals against: 10+', value: '-5' },
      { label: 'Win bonus', value: '+2' },
    ],
  },
];
