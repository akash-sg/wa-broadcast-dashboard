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

module.exports = { getVariants, setVariants };
