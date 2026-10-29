// Where each store's pages are, and how to read a listing's id from its address.
// Shared by the background worker and the popup (loaded with importScripts / <script>).

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by background.js and popup.js
const RELISTIC_SITES = {
  poshmark: {
    name: "Poshmark",
    createUrl: "https://poshmark.com/create-listing",
    editUrl: (t) => (t.remoteListingId ? `https://poshmark.com/edit-listing/${t.remoteListingId}` : t.remoteUrl),
    maxPhotos: 16,
    // https://poshmark.com/listing/Levis-Denim-Jacket-65f1c0ffee0123456789abcd
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/listing\/[^/]*-([0-9a-f]{24})\/?$/);
      return m ? { remoteListingId: m[1], url: `https://poshmark.com${url.pathname}` } : null;
    },
    isFormPage: (url) => /^\/(create|edit)-listing/.test(url.pathname),
  },
  depop: {
    name: "Depop",
    createUrl: "https://www.depop.com/products/create/",
    editUrl: (t) => (t.remoteListingId ? `https://www.depop.com/products/edit/${t.remoteListingId}/` : t.remoteUrl),
    maxPhotos: 4,
    // https://www.depop.com/products/sellername-levis-denim-jacket/
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/products\/([^/]+)\/?$/);
      if (!m || m[1] === "create" || m[1] === "edit") return null;
      return { remoteListingId: m[1], url: `https://www.depop.com/products/${m[1]}/` };
    },
    isFormPage: (url) => /^\/products\/(create|edit)\b/.test(url.pathname),
  },
  facebook: {
    name: "Facebook Marketplace",
    createUrl: "https://www.facebook.com/marketplace/create/item",
    editUrl: (t) =>
      t.remoteListingId ? `https://www.facebook.com/marketplace/edit/?listing_id=${t.remoteListingId}` : t.remoteUrl,
    maxPhotos: 10,
    // https://www.facebook.com/marketplace/item/1234567890/
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/marketplace\/item\/(\d+)/);
      return m ? { remoteListingId: m[1], url: `https://www.facebook.com/marketplace/item/${m[1]}/` } : null;
    },
    isFormPage: (url) => /^\/marketplace\/(create|edit)\b/.test(url.pathname),
    // After posting, Facebook shows your selling page rather than the new listing.
    postedWithoutLink: (url) => /^\/marketplace\/you\/selling/.test(url.pathname),
  },
  mercari: {
    name: "Mercari",
    createUrl: "https://www.mercari.com/sell/",
    editUrl: (t) => (t.remoteListingId ? `https://www.mercari.com/sell/edit/${t.remoteListingId}/` : t.remoteUrl),
    maxPhotos: 12,
    // https://www.mercari.com/us/item/m12345678901/
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/(?:us\/)?item\/(m\d+)/);
      return m ? { remoteListingId: m[1], url: `https://www.mercari.com/us/item/${m[1]}/` } : null;
    },
    isFormPage: (url) => /^\/sell\b/.test(url.pathname),
  },
  whatnot: {
    name: "Whatnot",
    createUrl: "https://www.whatnot.com/dashboard/listings/new",
    editUrl: (t) => t.remoteUrl,
    maxPhotos: 10,
    // https://www.whatnot.com/listing/TGlzdGluZ05vZGU6MTIzNDU2
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/listing\/([^/]+)/);
      return m ? { remoteListingId: m[1], url: `https://www.whatnot.com/listing/${m[1]}` } : null;
    },
    isFormPage: (url) => /^\/dashboard\/listings\/(new|[^/]+\/edit)/.test(url.pathname),
  },
  grailed: {
    name: "Grailed",
    createUrl: "https://www.grailed.com/sell/new",
    editUrl: (t) => (t.remoteListingId ? `https://www.grailed.com/listings/${t.remoteListingId}/edit` : t.remoteUrl),
    maxPhotos: 20,
    // https://www.grailed.com/listings/12345678-levis-denim-jacket
    listingFromUrl(url) {
      const m = url.pathname.match(/^\/listings\/(\d+)(?:-[^/]*)?\/?$/);
      return m ? { remoteListingId: m[1], url: `https://www.grailed.com/listings/${m[1]}` } : null;
    },
    isFormPage: (url) => /^\/(sell\b|listings\/\d+\/edit)/.test(url.pathname),
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- read by background.js and popup.js
const RELISTIC_DEFAULT_APP = "https://app.getrelistic.com";
