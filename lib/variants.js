// Message variant storage: { id, text } objects, text carries {{name}} and
// a channel link. Full CRUD lives in server.js routes on top of these two
// primitives when the dashboard is built.
'use strict';

const storage = require('./storage');
const KEY = 'variants';

function getVariants() {
  return storage.readJSON(KEY, []);
}

async function setVariants(variants) {
  await storage.writeJSON(KEY, variants);
  return variants;
}

// Atomic read-modify-write for add/edit/delete — a plain getVariants() +
// setVariants() pair from two concurrent requests can race and silently
// drop one side's change (same lost-update class fixed in contacts.js and
// campaign.js during review). mutatorFn receives the current array and
// returns the new one.
function mutateVariants(mutatorFn) {
  return storage.mutateJSON(KEY, mutatorFn, []);
}

module.exports = { getVariants, setVariants, mutateVariants };
