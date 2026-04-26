// UPSTREAM-DIVERGENCE-FILE: Mobile builds intentionally skip review diff rendering above this file
// count so large power-user change sets do not stall or terminate iOS/Android webviews.
export const MOBILE_REVIEW_FILE_LIMIT = 100

export function diffCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== "object") return 0
  return Object.keys(value).length
}

export function mobileReviewLimit(count: number, mobile: boolean, limit = MOBILE_REVIEW_FILE_LIMIT) {
  if (!mobile || count <= limit) return
  return { count, limit }
}
