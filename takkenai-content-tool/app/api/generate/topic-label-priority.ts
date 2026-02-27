export type TopicLabelOverridePriorityInput = {
  userOverrideLabel?: string;
  noteViralLabel?: string;
  motherTopicLabel?: string;
};

export function resolveTopicLabelOverrideByPriority(
  input: TopicLabelOverridePriorityInput
): string | undefined {
  const userLabel = String(input.userOverrideLabel || "").trim();
  if (userLabel) return userLabel;
  const viralLabel = String(input.noteViralLabel || "").trim();
  if (viralLabel) return viralLabel;
  const motherLabel = String(input.motherTopicLabel || "").trim();
  if (motherLabel) return motherLabel;
  return undefined;
}
