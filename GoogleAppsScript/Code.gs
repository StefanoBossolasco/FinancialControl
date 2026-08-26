/**
 * FinancialControl — Google Apps Script Backend
 * Espone data.json da Google Drive come API REST (GET/POST)
 *
 * SETUP (5 minuti):
 * 1. Vai su https://script.google.com → Nuovo progetto
 * 2. Incolla questo codice e salva
 * 3. Sostituisci FILE_ID con l'ID del tuo data.json su Google Drive
 *    (nell'URL del file: drive.google.com/file/d/<FILE_ID>/view)
 * 4. Imposta SECRET_TOKEN con una password a piacere
 * 5. "Distribuisci" → "Nuova distribuzione" → Tipo: App web
 *    - Esegui come: io (tuo account)
 *    - Accesso: Tutti (anyone)
 * 6. Copia il Web App URL → inseriscilo in FinancialControl > Impostazioni > Google Drive
 */

const FILE_ID      = 'INSERISCI_FILE_ID_QUI';         // ID del file data.json su Drive
const SECRET_TOKEN = 'SCEGLI_UNA_PASSWORD_SEGRETA';   // Token di sicurezza

// ── GET: lettura dati ────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'read';

  try {
    if (action === 'ping') {
      return json({ ok: true, message: 'FinancialControl API online' });
    }
    if (action === 'read') {
      const file    = DriveApp.getFileById(FILE_ID);
      const content = file.getBlob().getDataAsString('UTF-8');
      return ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JSON);
    }
    return json({ error: 'Azione sconosciuta' });
  } catch (err) {
    return json({ error: err.message });
  }
}

// ── POST: scrittura dati ─────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || 'write';
    const token  = body.token  || '';

    // Verifica token
    if (SECRET_TOKEN && SECRET_TOKEN !== 'SCEGLI_UNA_PASSWORD_SEGRETA' && token !== SECRET_TOKEN) {
      return json({ error: 'Token non autorizzato' });
    }

    if (action === 'write') {
      if (!body.data) return json({ error: 'Nessun dato da scrivere' });
      const file = DriveApp.getFileById(FILE_ID);
      file.setContent(JSON.stringify(body.data, null, 2));
      return json({ ok: true, message: 'Salvato su Google Drive', timestamp: new Date().toISOString() });
    }

    return json({ error: 'Azione sconosciuta' });
  } catch (err) {
    return json({ error: err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
