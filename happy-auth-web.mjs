// Headless happy auth — generates Web Browser auth URL directly
import { createRequire } from 'module';

const tweetnacl = (await import('/app/happy/node_modules/tweetnacl/nacl-fast.js')).default;
const axios     = (await import('/app/happy/node_modules/axios/index.js')).default;
import { randomBytes } from 'node:crypto';

const secret  = new Uint8Array(randomBytes(32));
const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
const b64     = (buf) => Buffer.from(buf).toString('base64');
const b64url  = (buf) => Buffer.from(buf).toString('base64url');

const serverUrl = process.env.HAPPY_SERVER_URL || 'https://api.cluster-fluster.com';
const webappUrl = process.env.HAPPY_WEBAPP_URL || 'https://app.happy.engineering';

try {
  await axios.post(serverUrl + '/v1/auth/request', {
    publicKey: b64(keypair.publicKey),
    supportsV2: true
  });
} catch (e) {
  console.error('auth request failed:', e.message);
  process.exit(1);
}

const authUrl = webappUrl + '/terminal/connect#key=' + b64url(keypair.publicKey);
console.log('\n==================================================');
console.log('Web Browser Auth URL for lixin:');
console.log('==================================================\n');
console.log(authUrl);
console.log('');
