#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const adapterPath = path.join(repoRoot, 'sites', 'google', 'adapter.js');

class FakeElement {
  constructor({
    text = '',
    href = '',
    ariaLabel = '',
    heading = null,
    link = null,
    websiteLinks = [],
    isMapsLink = false,
    classes = [],
    backgroundImage = '',
    onClick = null,
  } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.href = href;
    this.ariaLabel = ariaLabel;
    this.heading = heading;
    this.link = link;
    this.websiteLinks = websiteLinks;
    this.isMapsLink = isMapsLink;
    this.classes = classes;
    this.backgroundImage = backgroundImage;
    this.onClick = onClick;
  }

  matches(selector) {
    return this.isMapsLink && selector.includes('a[href*="/maps/place/"]');
  }

  querySelector(selector) {
    if (/role="heading"|h1|h2|h3/.test(selector)) return this.heading;
    if (selector.includes('a[href*="/maps/place/"]')) return this.link;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === 'a[href^="http"]') return this.websiteLinks;
    return [];
  }

  closest() {
    return this;
  }

  click() {
    this.onClick?.();
  }

  getAttribute(name) {
    return name === 'aria-label' ? this.ariaLabel : null;
  }

  getBoundingClientRect() {
    return {
      top: 100,
      left: 20,
      width: 360,
      height: 120,
      right: 380,
      bottom: 220,
    };
  }
}

const mapsLink = new FakeElement({
  href: 'https://www.google.com/maps/place/Soulmate/@34.073,-118.373,17z/data=!3m1!4b1',
  ariaLabel: 'Soulmate · Visited link',
  isMapsLink: true,
});
const websiteLink = new FakeElement({ href: 'https://www.soulmateweho.com/' });
const heading = new FakeElement({ text: 'Soulmate' });
const placeCard = new FakeElement({
  text: [
    'Soulmate · Visited link',
    '4.3 stars',
    '1,234 reviews',
    'Restaurant',
    '8320 W 3rd St, Los Angeles, CA',
    'Open until 11 PM',
    '(323) 555-0199',
    'Website',
  ].join('\n'),
  heading,
  link: mapsLink,
  websiteLinks: [websiteLink],
});
const hoursRows = [
  'Monday 11 AM to 9 PM, Copy open hours',
  'Tuesday 11 AM to 9 PM, Copy open hours',
  'Wednesday 11 AM to 9 PM, Copy open hours',
  'Thursday 11 AM to 9 PM, Copy open hours',
  'Friday 11 AM to 9 PM, Copy open hours',
  'Saturday 11 AM to 9 PM, Copy open hours',
  'Sunday 11 AM to 9 PM, Copy open hours',
].map(text => new FakeElement({ text }));

let photoPanelOpen = false;
const seePhotosButton = new FakeElement({
  text: 'See photos',
  onClick() {
    photoPanelOpen = true;
  },
});
const photoTabs = ['All', 'Latest', 'Videos', 'Menu', 'Food & drink', 'Vibe', 'Taco', 'By owner', 'Street View & 360°']
  .map(text => new FakeElement({ text }));
const photoTiles = [
  new FakeElement({
    text: '',
    ariaLabel: 'Photo 1 ',
    href: 'https://www.google.com/maps/place/Soulmate/data=!3m8!1e2!3m6!1sPHOTO_ID_1!2e10!3e12!6shttps:%2F%2Flh3.googleusercontent.com%2Fphoto1%3Dw203-h152-k-no!7i4032!8i3024',
    backgroundImage: 'url("https://lh3.googleusercontent.com/photo1=w203-h152-k-no")',
  }),
  new FakeElement({
    text: '0:15',
    ariaLabel: 'Video',
    href: 'https://www.google.com/maps/place/Soulmate/data=!3m8!1e2!3m6!1sVIDEO_ID_1!2e10!3e12!6shttps:%2F%2Flh3.googleusercontent.com%2Fvideo1%3Dw203-h360-k-no!7i1080!8i1920',
    backgroundImage: 'url("https://lh3.googleusercontent.com/video1=w203-h360-k-no")',
  }),
];

let registeredAdapter = null;
let networkEntries = [];
const currentLocation = new URL('https://www.google.com/maps/search/Soulmates%20Los%20Angeles');
currentLocation.assign = () => {};

const context = vm.createContext({
  console,
  setTimeout,
  URL,
  location: currentLocation,
  Node: { TEXT_NODE: 3 },
  NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
  getComputedStyle(element) {
    return { backgroundImage: element.backgroundImage || '' };
  },
  window: {
    innerHeight: 900,
    scrollY: 0,
    scrollBy() {},
    AiChromeRemote: {
      registerAdapter(adapter) {
        registeredAdapter = adapter;
      },
      getNetworkEntries() {
        return {
          entries: networkEntries,
          total: networkEntries.length,
          dropped: 0,
          nextId: networkEntries.length + 1,
        };
      },
    },
  },
  document: {
    body: new FakeElement({ text: placeCard.textContent }),
    querySelector(selector) {
      if (selector === 'div[role="feed"]') return null;
      if (selector === 'textarea[name="q"], input[name="q"]') return null;
      if (selector === 'a.MIgS0d') return photoPanelOpen ? photoTiles[0] : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('div[role="feed"] div[role="article"]')) return [placeCard];
      if (selector === 'table tr') return hoursRows;
      if (selector.includes('button.Dx2nRe')) return [seePhotosButton];
      if (selector.includes('button[role="tab"]')) return photoPanelOpen ? photoTabs : [];
      if (selector === 'a.MIgS0d') return photoPanelOpen ? photoTiles : [];
      return [];
    },
    createTreeWalker() {
      return {
        nextNode() {
          return false;
        },
      };
    },
  },
});

vm.runInContext(await readFile(adapterPath, 'utf8'), context, { filename: adapterPath });

assert.ok(registeredAdapter, 'Google adapter should register itself.');
assert.equal(typeof registeredAdapter.actions.researchGoogleMaps, 'function');
assert.equal(typeof registeredAdapter.actions.researchGoogleMapsPlace, 'function');

const result = await registeredAdapter.actions.researchGoogleMaps({
  query: 'Soulmates Los Angeles',
  location: '8320 W 3rd St Los Angeles CA',
  limit: 5,
  scroll: false,
  navigate: false,
});

assert.equal(result.id, 'googleMaps');
assert.equal(result.count, 1);
assert.equal(result.places[0].title, 'Soulmate');
assert.equal(result.places[0].address, '8320 W 3rd St, Los Angeles, CA');
assert.equal(result.places[0].rating.value, 4.3);
assert.equal(result.places[0].rating.count, 1234);
assert.equal(result.places[0].categories.join('|'), 'Restaurant');

context.document.body.heading = heading;

const placeResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Soulmates Los Angeles',
  location: '8320 W 3rd St Los Angeles CA',
  navigate: false,
});

assert.equal(placeResult.id, 'googleMapsPlace');
assert.equal(placeResult.found, true);
assert.equal(placeResult.place.title, 'Soulmate');
assert.equal(placeResult.place.address, '8320 W 3rd St, Los Angeles, CA');
assert.equal(placeResult.place.hours.length, 7);
assert.equal(placeResult.place.hours[0].text, '11 AM to 9 PM');

const originalBodyText = context.document.body.innerText;
const originalBodyTextContent = context.document.body.textContent;
context.document.body.heading = new FakeElement({ text: 'Hours' });
context.document.body.innerText = [
  'Hours',
  'Arden Restaurant Friday (4th of July (Observed)) 9 AM to 10:30 PM Hours might differ',
  '8289 Santa Monica Blvd, West Hollywood, CA 90046',
  'Open',
].join('\n');
context.document.body.textContent = context.document.body.innerText;
const hoursHeadingPlaceResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  navigate: false,
});

assert.equal(hoursHeadingPlaceResult.place.title, 'Arden Restaurant');
assert.equal(hoursHeadingPlaceResult.place.address, '8289 Santa Monica Blvd, West Hollywood, CA 90046');

context.document.body.heading = new FakeElement({ text: 'might differ' });
context.document.body.innerText = [
  'Hours might differ',
  'Arden Restaurant',
  'Friday (4th of July (Observed)) 9 AM to 10:30 PM Hours might differ',
  '8289 Santa Monica Blvd, West Hollywood, CA 90046',
  'Open',
].join('\n');
context.document.body.textContent = context.document.body.innerText;
const holidaySuffixPlaceResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  navigate: false,
});

assert.equal(holidaySuffixPlaceResult.place.title, 'Arden Restaurant');
assert.equal(holidaySuffixPlaceResult.place.address, '8289 Santa Monica Blvd, West Hollywood, CA 90046');

context.document.body.heading = new FakeElement({ text: 'Google Account: Johnathan Michaels (dredmoka@gmail.com)' });
context.document.body.innerText = [
  'Google Account: Johnathan Michaels (dredmoka@gmail.com)',
  'Arden Restaurant',
  '8289 Santa Monica Blvd, West Hollywood, CA 90046',
  'Restaurant',
].join('\n');
context.document.body.textContent = context.document.body.innerText;
const accountHeadingPlaceResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  navigate: false,
});

assert.equal(accountHeadingPlaceResult.place.title, 'Arden Restaurant');
assert.equal(accountHeadingPlaceResult.place.address, '8289 Santa Monica Blvd, West Hollywood, CA 90046');

const ardenNetworkRecord = [];
ardenNetworkRecord[2] = ['8289 Santa Monica Blvd', 'West Hollywood, CA 90046'];
ardenNetworkRecord[4] = [null, null, '$$', null, '$$', null, null, 4.3, 1028];
ardenNetworkRecord[7] = ['ardenweho.com'];
ardenNetworkRecord[9] = [null, null, 34.090991, -118.369982];
ardenNetworkRecord[10] = '0x80c2bf4884a00025:0x9615f28da843ceea';
ardenNetworkRecord[11] = 'Arden Restaurant';
ardenNetworkRecord[13] = ['Restaurant', 'Bar', 'Mediterranean restaurant'];
ardenNetworkRecord[17] = '8289 Santa Monica Blvd, West Hollywood, CA 90046';
ardenNetworkRecord[72] = [[
  [
    'ARDEN_HERO_PHOTO',
    10,
    12,
    '',
    null,
    null,
    ['https://lh3.googleusercontent.com/arden-hero=w408-h272-k-no', 'Arden Restaurant', [8192, 5464], [408, 240]]
  ]
]];
ardenNetworkRecord[105] = [[
  [[[2]]],
  [
    [
      [
        'ARDEN_GRID_PHOTO_1',
        10,
        12,
        'Dining room',
        null,
        null,
        ['https://lh3.googleusercontent.com/arden-grid-1=w118-h195-k-no', 'Arden Restaurant', [816, 1344], [203, 100]]
      ],
      [
        'ARDEN_GRID_PHOTO_2',
        10,
        12,
        'Menu',
        null,
        null,
        ['https://lh3.googleusercontent.com/arden-grid-2=w146-h195-k-no', 'Arden Restaurant', [4284, 5712], [203, 100]]
      ]
    ],
    1328
  ]
]];
ardenNetworkRecord[178] = [[
  '(213) 486-3339',
  [['(213) 486-3339', 1], ['+1 213-486-3339', 2]],
  null,
  '+12134863339',
  null,
  ['tel:+12134863339']
]];
ardenNetworkRecord[203] = [[
  ['Friday', 5, [2026, 7, 3], [['9 AM-10:30 PM', [[9], [22, 30]]]], 0, 1, ['4th of July (Observed) might affect these hours', '4th of July (Observed)', 2]],
  ['Saturday', 6, [2026, 7, 4], [['10 AM-10:30 PM', [[10], [22, 30]]]], 0, 1, ['4th of July might affect these hours', '4th of July', 2]],
  ['Sunday', 7, [2026, 7, 5], [['10 AM-3:30 PM', [[10], [15, 30]]], ['5:30-9:30 PM', [[17, 30], [21, 30]]]], 0, 1],
  ['Monday', 1, [2026, 7, 6], [['9:30 AM-8:30 PM', [[9, 30], [20, 30]]]], 0, 1],
  ['Tuesday', 2, [2026, 7, 7], [['9:30 AM-8:30 PM', [[9, 30], [20, 30]]]], 0, 1],
  ['Wednesday', 3, [2026, 7, 8], [['9 AM-9:30 PM', [[9], [21, 30]]]], 0, 1],
  ['Thursday', 4, [2026, 7, 9], [['9 AM-9:30 PM', [[9], [21, 30]]]], 0, 1]
]];

networkEntries = [{
  id: 1,
  timestamp: '2026-07-04T00:00:00.000Z',
  type: 'fetch',
  method: 'GET',
  url: 'https://www.google.com/search?tbm=map&q=Arden%20West%20Hollywood',
  status: 200,
  ok: true,
  durationMs: 42,
  responseHeaders: { 'content-type': 'application/json; charset=UTF-8' },
  responseTextPreview: JSON.stringify([['Arden West Hollywood', [[ardenNetworkRecord]]]]),
}];
context.document.body.heading = new FakeElement({ text: 'might differ' });
context.document.body.innerText = [
  'Hours might differ',
  'Friday (4th of July (Observed)) 9 AM to 10:30 PM Hours might differ',
  '8289 Santa Monica Blvd, West Hollywood, CA 90046',
  'Open',
].join('\n');
context.document.body.textContent = context.document.body.innerText;
const networkFirstPlaceResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  navigate: false,
});

assert.equal(networkFirstPlaceResult.place.title, 'Arden Restaurant');
assert.equal(networkFirstPlaceResult.place.address, '8289 Santa Monica Blvd, West Hollywood, CA 90046');
assert.equal(networkFirstPlaceResult.place.websiteUrl, 'https://ardenweho.com/');
assert.equal(networkFirstPlaceResult.place.rating.value, 4.3);
assert.equal(networkFirstPlaceResult.place.rating.count, 1028);
assert.equal(networkFirstPlaceResult.place.primaryCategory, 'Restaurant');
assert.equal(networkFirstPlaceResult.place.phone, '(213) 486-3339');
assert.equal(networkFirstPlaceResult.place.hours.length, 7);
assert.equal(networkFirstPlaceResult.place.hours[0].day, 'Monday');
assert.equal(networkFirstPlaceResult.place.hours[0].text, '9:30 AM-8:30 PM');
assert.equal(networkFirstPlaceResult.place.hours[4].day, 'Friday');
assert.equal(
  JSON.stringify(networkFirstPlaceResult.place.hours[4].notes),
  JSON.stringify(['4th of July (Observed) might affect these hours', '4th of July (Observed)'])
);

photoPanelOpen = false;
const networkPhotoPlaceResult = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  navigate: false,
  includePhotos: true,
  photoLimit: 2,
});

assert.equal(networkPhotoPlaceResult.place.photos.source, 'googleMapsNetwork');
assert.equal(networkPhotoPlaceResult.place.photos.items.length, 2);
assert.equal(networkPhotoPlaceResult.place.photos.items[0].url, 'https://lh3.googleusercontent.com/arden-hero=w408-h272-k-no');
assert.equal(networkPhotoPlaceResult.place.photos.items[1].label, 'Dining room');
assert.equal(photoPanelOpen, false);

placeCard.heading = new FakeElement({ text: 'Hours' });
placeCard.innerText = [
  'Hours might differ',
  '8289 Santa Monica Blvd, West Hollywood, CA 90046',
  'Open',
].join('\n');
placeCard.textContent = placeCard.innerText;
mapsLink.href = 'https://www.google.com/maps/place/Arden/@34.090991,-118.369982,17z/data=!3m1!4b1';
mapsLink.ariaLabel = 'Hours';
context.document.body.heading = null;
context.document.body.innerText = placeCard.innerText;
context.document.body.textContent = placeCard.textContent;
const networkFirstSearchResult = await registeredAdapter.actions.researchGoogleMaps({
  query: 'Arden West Hollywood',
  location: 'West Hollywood CA',
  limit: 3,
  scroll: false,
  navigate: false,
});

assert.equal(networkFirstSearchResult.places[0].title, 'Arden Restaurant');
assert.equal(networkFirstSearchResult.places[0].address, '8289 Santa Monica Blvd, West Hollywood, CA 90046');
assert.equal(networkFirstSearchResult.places[0].rating.value, 4.3);
assert.equal(networkFirstSearchResult.places[0].rating.count, 1028);

networkEntries = [];
placeCard.heading = heading;
placeCard.innerText = originalBodyText;
placeCard.textContent = originalBodyText;
mapsLink.href = 'https://www.google.com/maps/place/Soulmate/@34.073,-118.373,17z/data=!3m1!4b1';
mapsLink.ariaLabel = 'Soulmate · Visited link';
context.document.body.heading = heading;
context.document.body.innerText = originalBodyText;
context.document.body.textContent = originalBodyTextContent;

const placeWithPhotos = await registeredAdapter.actions.researchGoogleMapsPlace({
  query: 'Soulmates Los Angeles',
  location: '8320 W 3rd St Los Angeles CA',
  navigate: false,
  includePhotos: true,
  photoCategories: ['All', 'Other'],
  photoLimit: 2,
});

assert.equal(placeWithPhotos.place.photos.source, 'googleMaps');
assert.equal(JSON.stringify(placeWithPhotos.place.photos.availableCategories.slice(0, 3)), JSON.stringify(['All', 'Latest', 'Videos']));
assert.equal(placeWithPhotos.place.photos.categories[0].label, 'All');
assert.equal(placeWithPhotos.place.photos.categories[0].items.length, 2);
assert.equal(placeWithPhotos.place.photos.categories[0].items[0].category, 'All');
assert.equal(placeWithPhotos.place.photos.categories[0].items[0].url, 'https://lh3.googleusercontent.com/photo1=w203-h152-k-no');
assert.equal(placeWithPhotos.place.photos.categories[0].items[1].type, 'video');
assert.equal(placeWithPhotos.place.photos.categories[1].label, 'Other');
assert.ok(placeWithPhotos.place.photos.categories[1].sourceCategories.includes('Taco'));

console.log('Google Maps adapter regression passed.');
