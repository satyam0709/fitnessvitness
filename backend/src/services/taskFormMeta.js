"use strict";

const { WEEKDAYS, sanitizeRecurrence, getReminderFormMeta } = require("./reminderFormMeta");

const FREQUENCY_NOTES = {
  once: null,
  daily: "Note: Daily task create every day",
  weekly: "Note: Weekly task create every 1 week",
  monthly: "Note: Monthly task create every 1 month",
  quarterly: "Note: Quarterly task create every 3 month",
  half_yearly: "Note: Half yearly task create every 6 month",
  yearly: "Note: Yearly task create every 1 year",
};

function getTaskFormMeta() {
  const base = getReminderFormMeta();
  return {
    frequencies: base.frequencies,
    weekdays: WEEKDAYS,
    frequency_notes: FREQUENCY_NOTES,
  };
}

module.exports = {
  WEEKDAYS,
  FREQUENCY_NOTES,
  sanitizeRecurrence,
  getTaskFormMeta,
};
