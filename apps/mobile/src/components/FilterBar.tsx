import React from 'react';
import { View, Pressable, Text, type PressableProps, type TextProps, type ViewProps } from 'react-native';
import type { Position } from '../constants/fantasyRules';

type PositionValue = Position | null;

interface FilterBarProps {
  selected: PositionValue;
  onSelect: (position: PositionValue) => void;
}

const PressableNW = Pressable as unknown as React.ComponentType<
  PressableProps & { className?: string }
>;

const TextNW = Text as unknown as React.ComponentType<TextProps & { className?: string }>;

const ViewNW = View as unknown as React.ComponentType<ViewProps & { className?: string }>;

function FilterBarImpl({ selected, onSelect }: FilterBarProps) {
  const Btn = ({ label, val }: { label: string; val: PositionValue }) => {
    const active = selected === val || (val === null && selected === null);
    return (
      <PressableNW
        onPress={() => onSelect(val)}
        className={`px-3 py-2 rounded-lg border ${
          active ? 'bg-orange-500 border-orange-500' : 'border-gray-500'
        }`}
        style={{ minWidth: 56, alignItems: 'center' }}
      >
        <TextNW className={active ? 'text-white font-semibold' : 'text-gray-200 font-semibold'}>
          {label}
        </TextNW>
      </PressableNW>
    );
  };

  return (
    <ViewNW
      className="flex-row justify-between items-center mb-3 px-4 py-2 bg-[#0f172a]"
      style={{ minHeight: 56 }}
    >
      <Btn label="All" val={null} />
      <Btn label="Attackers" val="A" />
      <Btn label="Defenders" val="D" />
      <Btn label="Goalies" val="V" />
    </ViewNW>
  );
}

export default React.memo(FilterBarImpl);











