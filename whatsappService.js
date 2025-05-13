// WhServerHijo01/whatsappService.js
import fs from 'fs';
import { db, bucket } from './firebaseAdmin.js';
import { getWhatsAppSock } from './whatsappServer.js';

// sendMessageToLead original, ajustado para usar getWhatsAppSock()
export async function sendMessageToLead(phone, messageContent) {
  const sock = await getWhatsAppSock();
  if (!sock) throw new Error('No hay conexión activa con WhatsApp');

  // Normalizar E.164 sin '+'
  let num = String(phone).replace(/\D/g, '');
  if (num.length === 10) num = '52' + num;
  const jid = `${num}@s.whatsapp.net`;

  // Enviar mensaje
  await sock.sendMessage(jid, { text: messageContent });

  // Guardar en Firestore bajo sender 'business'
  const q = await db.collection('leads')
                   .where('telefono', '==', num)
                   .limit(1)
                   .get();

  if (!q.empty) {
    const leadRef = q.docs[0].ref;
    const outMsg = {
      content: messageContent,
      sender: 'business',
      timestamp: new Date()
    };
    await leadRef.collection('messages').add(outMsg);
    await leadRef.update({ lastMessageAt: outMsg.timestamp });
  }

  return { success: true };
}

// sendAudioMessage original, ajustado para usar bucket exportado
export async function sendAudioMessage(phone, filePath) {
  const sock = await getWhatsAppSock();
  if (!sock) throw new Error('Socket de WhatsApp no está conectado');

  let num = String(phone).replace(/\D/g, '');
  if (num.length === 10) num = '52' + num;
  const jid = `${num}@s.whatsapp.net`;

  // 1) Leer y enviar por Baileys como audio/mp4
  const audioBuffer = fs.readFileSync(filePath);
  await sock.sendMessage(jid, {
    audio: audioBuffer,
    mimetype: 'audio/mp4',
    ptt: true,
  });

  // 2) Subir a Firebase Storage
  const dest = `audios/${num}-${Date.now()}.m4a`;
  const file = bucket.file(dest);
  await file.save(audioBuffer, { contentType: 'audio/mp4' });
  const [mediaUrl] = await file.getSignedUrl({
    action: 'read',
    expires: '03-01-2500'
  });

  // 3) Guardar en Firestore
  const q = await db.collection('leads')
                    .where('telefono', '==', num)
                    .limit(1)
                    .get();

  if (!q.empty) {
    const leadRef = q.docs[0].ref;
    const msgData = {
      content: '',
      mediaType: 'audio',
      mediaUrl,
      sender: 'business',
      timestamp: new Date()
    };
    await leadRef.collection('messages').add(msgData);
    await leadRef.update({ lastMessageAt: msgData.timestamp });
  }

  return { success: true };
}
