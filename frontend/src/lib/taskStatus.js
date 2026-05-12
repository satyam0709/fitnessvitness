/**
 * Maps UI / API task status labels to MySQL ENUM values always supported in production:
 * `todo` | `in_progress` | `done`.
 * Use for POST/PUT bodies so unmigrated databases never see truncated `status`.
 */
export function taskStatusForDb(s) {
  const k = String(s ?? "todo").toLowerCase();
  if (k === "in_feedback" || k === "processing" || k === "in_progress") {
    return "in_progress";
  }
  if (k === "completed" || k === "done") {
    return "done";
  }
  return "todo";
}
