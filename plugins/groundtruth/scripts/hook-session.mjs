// SessionStart hook: inject the always-on evidence contract.
import { readStdin, emit } from './lib/core.mjs';
import { CONTRACT } from './lib/contract.mjs';

const input = readStdin();
const event = String(input.hook_event_name || 'SessionStart');

if (event !== 'SessionStart') {
  emit(null);
} else {
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: CONTRACT,
    },
  });
}
