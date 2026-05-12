/**
 * Historically workspace access used a dedicated socket. We now piggyback on the shared
 * realtime connection from chatRealtime so the app keeps one stable connection lifecycle.
 */
export { subscribeWorkspaceAccess } from "./chatRealtime";
