// WhServerHijo01/whatsappServer.js
import {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage
  } from '@whiskeysockets/baileys';
  import QRCode from 'qrcode-terminal';
  import Pino from 'pino';
  import fs from 'fs';
  import path from 'path';
  import { db, bucket, adminSdk } from './firebaseAdmin.js';
  
  let latestQR = null;
  let connectionStatus = "Desconectado";
  let whatsappSock = null;
  let sessionPhone = null;
  
  const localAuthFolder = '/var/data';
  
  export async function connectToWhatsApp() {
    try {
      // Asegurar carpeta de auth
      if (!fs.existsSync(localAuthFolder)) {
        fs.mkdirSync(localAuthFolder, { recursive: true });
      }
  
      const { state, saveCreds } = await useMultiFileAuthState(localAuthFolder);
  
      // Extraer número de sesión si ya existe
      if (state.creds.me?.id) {
        sessionPhone = state.creds.me.id.split('@')[0];
      }
  
      const { version } = await fetchLatestBaileysVersion();
      const sock = makeWASocket({
        auth: state,
        logger: Pino({ level: 'info' }),
        printQRInTerminal: true,
        version,
      });
      whatsappSock = sock;
  
      // Manejo de conexión
      sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          latestQR = qr;
          connectionStatus = "QR disponible. Escanéalo.";
          QRCode.generate(qr, { small: true });
        }
        if (connection === 'open') {
          connectionStatus = "Conectado";
          latestQR = null;
          if (sock.user?.id) {
            sessionPhone = sock.user.id.split('@')[0];
          }
        }
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          connectionStatus = "Desconectado";
          if (code === DisconnectReason.loggedOut) {
            // Borrar credenciales y forzar nuevo login
            fs.readdirSync(localAuthFolder).forEach(f =>
              fs.rmSync(path.join(localAuthFolder, f), { force: true, recursive: true })
            );
            sessionPhone = null;
          }
          // Reiniciar
          connectToWhatsApp().catch(console.error);
        }
      });
  
      // Guardar credenciales
      sock.ev.on('creds.update', saveCreds);
  
      // Listener de mensajes entrantes
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
  
        for (const msg of messages) {
          if (!msg.key?.remoteJid || msg.key.remoteJid.endsWith('@g.us')) continue;
  
          const phone = msg.key.remoteJid.split('@')[0];
          const sender = msg.key.fromMe ? 'business' : 'lead';
  
          let content = '';
          let mediaType = null;
          let mediaUrl = null;
  
          // 1) Video
          if (msg.message.videoMessage) {
            mediaType = 'video';
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: Pino() });
            const fileName = `videos/${phone}-${Date.now()}.mp4`;
            const file = bucket.file(fileName);
            await file.save(buffer, { contentType: 'video/mp4' });
            [mediaUrl] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
          }
          // 2) Imagen
          else if (msg.message.imageMessage) {
            mediaType = 'image';
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: Pino() });
            const fileName = `images/${phone}-${Date.now()}.jpg`;
            const file = bucket.file(fileName);
            await file.save(buffer, { contentType: 'image/jpeg' });
            [mediaUrl] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
          }
          // 3) Audio
          else if (msg.message.audioMessage) {
            mediaType = 'audio';
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: Pino() });
            const fileName = `audios/${phone}-${Date.now()}.ogg`;
            const file = bucket.file(fileName);
            await file.save(buffer, { contentType: 'audio/ogg' });
            [mediaUrl] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
          }
          // 4) PDF
          else if (msg.message.documentMessage?.mimetype === 'application/pdf') {
            mediaType = 'pdf';
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: Pino() });
            const fileName = `pdfs/${phone}-${Date.now()}.pdf`;
            const file = bucket.file(fileName);
            await file.save(buffer, { contentType: 'application/pdf' });
            [mediaUrl] = await file.getSignedUrl({ action: 'read', expires: '03-01-2500' });
          }
          // 5) Texto
          else {
            content = msg.message.conversation
                    ?? msg.message.extendedTextMessage?.text
                    ?? '';
          }
  
          // Buscar o crear lead
          let leadRef;
          const q = await db.collection('leads')
                          .where('telefono', '==', phone)
                          .limit(1)
                          .get();
          if (q.empty) {
            const cfgSnap = await db.collection('config').doc('appConfig').get();
            const cfg = cfgSnap.exists ? cfgSnap.data() : {};
            if (!cfg.autoSaveLeads) continue;
            leadRef = await db.collection('leads').add({
              telefono: phone,
              nombre: msg.pushName || '',
              source: 'WhatsApp',
              fecha_creacion: new Date(),
              estado: 'nuevo',
              etiquetas: [cfg.defaultTrigger || 'NuevoLead'],
              secuenciasActivas: [],
              unreadCount: 0,
              lastMessageAt: new Date()
            });
          } else {
            leadRef = q.docs[0].ref;
          }
  
          // Guardar mensaje
          const msgData = {
            content,
            mediaType,
            mediaUrl,
            sender,
            timestamp: new Date()
          };
          await leadRef.collection('messages').add(msgData);
  
          // Actualizar lead
          const updateData = { lastMessageAt: msgData.timestamp };
          if (sender === 'lead') {
            updateData.unreadCount = adminSdk.firestore.FieldValue.increment(1);
          }
          await leadRef.update(updateData);
        }
      });
  
      return sock;
    } catch (error) {
      console.error("Error al conectar con WhatsApp:", error);
      throw error;
    }
  }
  
  export function getLatestQR() {
    return latestQR;
  }
  
  export function getConnectionStatus() {
    return connectionStatus;
  }
  
  export function getSessionPhone() {
    return sessionPhone;
  }
  
  export function getWhatsAppSock() {
    return whatsappSock;
  }
  