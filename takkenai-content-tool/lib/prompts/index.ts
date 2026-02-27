/**
 * Prompt module index.
 *
 * Re-exports all platform-specific prompts for convenience.
 * The main consumer of these is lib/claude.ts which imports them directly.
 */

export { AMEBA_SYSTEM_PROMPT, buildAmebaUserPrompt } from "./ameba";
export { NOTE_SYSTEM_PROMPT, buildNoteUserPrompt } from "./note";
export { HATENA_SYSTEM_PROMPT, buildHatenaUserPrompt } from "./hatena";
