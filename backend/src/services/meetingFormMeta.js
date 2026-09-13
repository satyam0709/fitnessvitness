"use strict";

const {
  getReminderFormMeta,
  computeRemindAt,
  sanitizeRecurrence,
  sanitizeWeekday,
  parseTimeHm,
  FREQUENCY_NOTES,
  WEEKDAYS,
} = require("./reminderFormMeta");

const MEETING_TEMPLATES = [
  {
    key: "standup",
    label: "Standup",
    title: "Team standup",
    message: "Quick sync on progress, blockers, and next steps.",
  },
  {
    key: "sales",
    label: "Sales call",
    title: "Sales meeting",
    message: "Discuss requirements, pricing, and next actions with the customer.",
  },
  {
    key: "support",
    label: "Support",
    title: "Support meeting",
    message: "Review open issues and confirm resolution timeline.",
  },
];

function getMeetingFormMeta() {
  const base = getReminderFormMeta();
  return {
    ...base,
    templates: MEETING_TEMPLATES,
    frequency_notes: FREQUENCY_NOTES,
  };
}

module.exports = {
  getMeetingFormMeta,
  computeRemindAt,
  sanitizeRecurrence,
  sanitizeWeekday,
  parseTimeHm,
  WEEKDAYS,
  MEETING_TEMPLATES,
};
