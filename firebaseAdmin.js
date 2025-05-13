// WhServerHijo01/firebaseAdmin.js
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Render monta tu servicio con los secretos en /etc/secrets/serviceAccountKey.json
const firebaseKeyPath = path.join('/etc/secrets', 'serviceAccountKey.json');
if (!fs.existsSync(firebaseKeyPath)) {
  throw new Error(`No se encontró el archivo secreto de Firebase en ${firebaseKeyPath}`);
}
const serviceAccount = JSON.parse(fs.readFileSync(firebaseKeyPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'merkagrama-crm.firebasestorage.app'
});

export const db       = admin.firestore();
export const adminSdk = admin;
export const bucket   = admin.storage().bucket();
export const FieldValue = admin.firestore.FieldValue;