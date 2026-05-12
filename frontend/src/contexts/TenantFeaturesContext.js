"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBase, getTenantSubdomainFromHost, apiFetch } from "@/lib/api";
import { useUserRole } from "@/components/Dashboard/UserRoleContext";

const TenantFeaturesContext = createContext({
  features: [],
  featureMap: {},
  addons: [],
  planStatus: "none",
  seatsUsed: 0,
  seatsMax: 0,
  packageName: null,
  validUntil: null,
  isLoading: true,
  error: null,
  refetch: async () => {},
});

const CACHE_TTL = 60_000;
let featuresCache = null;
let cacheTime = 0;
let invalidateFeaturesImpl = async () => {};

export function TenantFeaturesProvider({ children }) {
  const { isLoaded, isSignedIn } = useAuth();
  const [features, setFeatures] = useState([]);
  const [featureMap, setFeatureMap] = useState({});
  const [addons, setAddons] = useState([]);
  const [planStatus, setPlanStatus] = useState("none");
  const [seatsUsed, setSeatsUsed] = useState(0);
  const [seatsMax, setSeatsMax] = useState(0);
  const [packageName, setPackageName] = useState(null);
  const [validUntil, setValidUntil] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setIsLoading(false);
      setFeatures([]);
      setFeatureMap({});
      setAddons([]);
      return null;
    }
    setError(null);
    setIsLoading(true);
    try {
      const res = await apiFetch("/me/features");
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Could not load plan features");
        setFeatures([]);
        setFeatureMap({});
        setAddons([]);
        return null;
      }
      const d = data.data || {};
      setFeatures(Array.isArray(d.features) ? d.features : []);
      setFeatureMap(d.featureMap && typeof d.featureMap === "object" ? d.featureMap : {});
      setAddons(Array.isArray(d.addons) ? d.addons : []);
      setPlanStatus(d.planStatus || "none");
      setSeatsUsed(Number(d.seatsUsed) || 0);
      setSeatsMax(Number(d.seatsMax) || 0);
      setPackageName(d.packageName || null);
      setValidUntil(d.validUntil || null);
      return d;
    } catch (e) {
      setError(e.message || "Network error");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    // FIXED: 7 avoid route-change refetch; serve cached features within TTL
    const now = Date.now();
    if (featuresCache && now - cacheTime < CACHE_TTL) {
      const d = featuresCache;
      setFeatures(Array.isArray(d.features) ? d.features : []);
      setFeatureMap(d.featureMap && typeof d.featureMap === "object" ? d.featureMap : {});
      setAddons(Array.isArray(d.addons) ? d.addons : []);
      setPlanStatus(d.planStatus || "none");
      setSeatsUsed(Number(d.seatsUsed) || 0);
      setSeatsMax(Number(d.seatsMax) || 0);
      setPackageName(d.packageName || null);
      setValidUntil(d.validUntil || null);
      setIsLoading(false);
      return;
    }
    load().then((d) => {
      if (d) {
        featuresCache = d;
        cacheTime = Date.now();
      }
    });
  }, [load]);

  useEffect(() => {
    invalidateFeaturesImpl = async () => {
      featuresCache = null;
      cacheTime = 0;
      const d = await load();
      if (d) {
        featuresCache = d;
        cacheTime = Date.now();
      }
      return d;
    };
  }, [load]);

  const value = useMemo(
    () => ({
      features,
      featureMap,
      addons,
      planStatus,
      seatsUsed,
      seatsMax,
      packageName,
      validUntil,
      isLoading,
      error,
      refetch: invalidateFeaturesImpl,
    }),
    [features, featureMap, addons, planStatus, seatsUsed, seatsMax, packageName, validUntil, isLoading, error]
  );

  return <TenantFeaturesContext.Provider value={value}>{children}</TenantFeaturesContext.Provider>;
}

export function useTenantFeatures() {
  return useContext(TenantFeaturesContext);
}

export function useHasFeature(featureKey) {
  const { featureMap, isLoading } = useTenantFeatures();
  const { me, loading: roleLoading } = useUserRole();
  const k = String(featureKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const isPlatform =
    Number(me?.is_platform_admin) === 1 ||
    (me?.role === "admin" && (me?.tenant_id == null || me?.tenant_id === ""));
  if (!roleLoading && isPlatform) return true;
  if (isLoading) return false;
  if (k === "opportunities") {
    return Boolean(
      featureMap.opportunities ||
        featureMap.opportunity_management ||
        featureMap.customer_management
    );
  }
  if (k === "reminders") {
    return Boolean(featureMap.reminders || featureMap.reminder);
  }
  return Boolean(featureMap[k]);
}

export async function invalidateFeatures() {
  return invalidateFeaturesImpl();
}

export function FeatureGate({ feature, children, fallback = null }) {
  const ok = useHasFeature(feature);
  if (!ok) return fallback;
  return children;
}
