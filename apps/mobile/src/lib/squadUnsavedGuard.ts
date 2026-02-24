export type SquadUnsavedGuard = {
  isDirty: boolean;
  save: () => Promise<{ ok: boolean; error?: string }>;
  discard: () => Promise<void> | void;
};

let currentGuard: SquadUnsavedGuard | null = null;

export function setSquadUnsavedGuard(guard: SquadUnsavedGuard | null) {
  currentGuard = guard;
}

export function getSquadUnsavedGuard() {
  return currentGuard;
}
