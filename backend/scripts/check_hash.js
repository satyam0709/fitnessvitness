const bcrypt = require('bcrypt');

async function check() {
  const hash = '$2b$12$8PnImkRs4qwcQgEEiw/U9O.7lmvFSxvIajqObz4ds/L5gQxXxUZVq';
  const pass = 'RNDTECH@123';
  const match = await bcrypt.compare(pass, hash);
  console.log(`Match for ${pass} against hash ${hash}:`, match);
}

check();
