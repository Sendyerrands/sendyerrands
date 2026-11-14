import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const API = 'https://sendyerrands.onrender.com/api/v1';
const EMAIL = `zz-upload-probe-${Date.now()}@example.invalid`;
const PASS = 'UploadProbe!' + Date.now();
let vendorId: string | null = null;

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function main() {
  const v = await prisma.vendor.create({
    data: { name: 'ZZ Upload Probe', slug: `zz-upload-probe-${Date.now()}`,
      email: EMAIL, phone: '0000000000', state: 'Lagos',
      passwordHash: await bcrypt.hash(PASS, 10), isVerified: false, isOpen: false },
    select: { id: true },
  });
  vendorId = v.id;

  const login = await (await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS, role: 'vendor' }),
  })).json();
  const token = login.data?.token;
  console.log(`1. signed in as a vendor: ${token ? 'ok' : 'FAILED'}\n`);

  // 2. exactly what the app asks for
  const sigRes = await fetch(`${API}/uploads/signature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ folder: 'product-images' }),
  });
  const sigJson = await sigRes.json();
  console.log(`2. POST /uploads/signature -> ${sigRes.status}`);
  if (!sigRes.ok) { console.log('   ', JSON.stringify(sigJson)); return; }
  const sig = sigJson.data;
  console.log(`   cloudName=${sig.cloudName} apiKey=${String(sig.apiKey).slice(0,6)}... folder=${sig.folder}`);
  console.log(`   uploadUrl=${sig.uploadUrl}\n`);

  // 3. the real upload, same fields and order the app sends
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('folder', sig.folder);
  form.append('signature', sig.signature);

  const up = await fetch(sig.uploadUrl, { method: 'POST', body: form });
  const upJson: any = await up.json();
  console.log(`3. POST to Cloudinary -> ${up.status}`);
  if (upJson.secure_url) {
    console.log(`   UPLOAD SUCCEEDED: ${upJson.secure_url}`);
    console.log(`   public_id=${upJson.public_id}`);
    (globalThis as any).__cleanupPublicId = upJson.public_id;
  } else {
    console.log(`   UPLOAD FAILED: ${JSON.stringify(upJson)}`);
  }
}

main()
  .catch((e) => console.error('ERROR:', e.message))
  .finally(async () => {
    if (vendorId) await prisma.vendor.delete({ where: { id: vendorId } });
    console.log('\ncleanup: temp vendor removed');
    const pid = (globalThis as any).__cleanupPublicId;
    if (pid) console.log(`NOTE: test asset left on Cloudinary: ${pid}`);
    await prisma.$disconnect();
  });
