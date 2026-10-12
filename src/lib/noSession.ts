// Audit Oct 13 (4): the error name db.ts gives a write made with no local session.
// The outbox keeps such a write while offline and drops it only online + signed out.
export const NO_SESSION_ERROR = "NoSessionError";
