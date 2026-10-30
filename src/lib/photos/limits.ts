// Shared by the upload page (which resizes in the browser) and the upload route.
// How many photos a batch holds depends on the plan (photosPerBatch in lib/billing/plans).
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
// Longest edge in pixels. eBay recommends at least 500 and zooms from 800 up.
export const PHOTO_EDGE = 1600;
export const THUMB_EDGE = 400;
// eBay allows 24 photos per listing, Etsy 20.
export const MAX_PHOTOS_PER_ITEM = 20;
