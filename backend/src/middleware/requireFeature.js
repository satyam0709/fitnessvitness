/** Optional feature gate — reads same keys as GET /api/me/features */

const FEATURE_ALIASES = {
  lead_management: "leads",
  leads: "leads",
  opportunities: "opportunities",
};

const DEFAULT_FEATURES = {
  leads: true,
  opportunities: true,
  tickets: true,
  tasks: true,
  reminders: true,
  meetings: true,
  todos: true,
  calendar: true,
  contacts: true,
  companies: true,
  storage: true,
  reports: true,
  fitness: true,
  analytics: true,
};

function requireFeature(featureKey) {
  const normalized = FEATURE_ALIASES[featureKey] || featureKey;

  return (req, res, next) => {
    const map = req.features?.featureMap || DEFAULT_FEATURES;
    if (map[normalized] === false) {
      return res.status(403).json({
        success: false,
        message: `Feature "${featureKey}" is not enabled for your account`,
      });
    }
    return next();
  };
}

module.exports = { requireFeature, FEATURE_ALIASES, DEFAULT_FEATURES };
