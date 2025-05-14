// WhServerHijo01/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { connectToWhatsApp, getLatestQR, getConnectionStatus, getSessionPhone } from './whatsappServer.js';
import { sendMessageToLead, sendAudioMessage } from './whatsappService.js';
import { db, adminSdk } from './firebaseAdmin.js';

dotenv.config();
const SESSION_ID = process.env.SESSION_ID;         // ej. "01"
const BASE_URL   = process.env.CHILD_BASE_URL;     // tu URL en Render
const app = express();
app.use(cors());
app.use(express.json());

// 1) Arranca WhatsApp y registra/heartbeat en Firestore
connectToWhatsApp().then(async () => {
  const ref = db.collection('whatsappServers').doc(SESSION_ID);
   // Registro inicial del hijo en Firestore, con estado de trabajo
 await ref.set({
   sessionId:          SESSION_ID,
   baseUrl:            BASE_URL,
   status:             getConnectionStatus(),
   workState:          "resting",                                    // <-- nuevo
   lastWorkSwitchedAt: adminSdk.firestore.FieldValue.serverTimestamp(), // <-- nuevo
   lastSeen:           adminSdk.firestore.FieldValue.serverTimestamp()
 }, { merge: true });

  setInterval(() => {
    ref.update({
      status: getConnectionStatus(),
      lastSeen: adminSdk.firestore.FieldValue.serverTimestamp()
    });
  }, 5 * 60 * 1000);
}).catch(console.error);

// 2) Endpoints de estado (opcional, para tu frontend de QR)
app.get('/api/whatsapp/status', (req, res) => {
  res.json({
    status: getConnectionStatus(),
    qr: getLatestQR(),
    phone: getSessionPhone()
  });
});

// 3) Endpoint para envío de texto
app.post('/api/send/text', async (req, res) => {
  try {
    const { phone, text } = req.body;
    await sendMessageToLead(phone, text);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 4) Endpoint para envío de audio
app.post('/api/send/audio', async (req, res) => {
  try {
    const { phone, filePath } = req.body;
    await sendAudioMessage(phone, filePath);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhServerHijo${SESSION_ID} escuchando en puerto ${PORT}`);
});
