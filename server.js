const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'no-reply@seu-dominio.com';
const TO_EMAIL = process.env.TO_EMAIL || 'rbrandel@gmail.com';

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;

    const [key, ...rest] = trimmed.split('=');
    const value = rest.join('=').trim();
    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

loadEnvFile();

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeText(value, maxLength = 2000) {
  return String(value ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePhone(value) {
  return String(value ?? '')
    .replace(/[^\d+\-\s()]/g, '')
    .trim();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

async function sendEmailViaResend(payload) {
  if (!RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      reply_to: payload.email,
      subject: `Contato Radar de IA - ${payload.name}`,
      html: `
        <h3>Novo contato do Radar de IA</h3>
        <p><strong>Nome:</strong> ${payload.name}</p>
        <p><strong>E-mail:</strong> ${payload.email}</p>
        <p><strong>WhatsApp:</strong> ${payload.whatsapp}</p>
        <p><strong>Mensagem:</strong><br>${payload.message || 'Sem mensagem adicional.'}</p>
      `,
      text: `Novo contato do Radar de IA\n\nNome: ${payload.name}\nE-mail: ${payload.email}\nWhatsApp: ${payload.whatsapp}\nMensagem: ${payload.message || 'Sem mensagem adicional.'}`
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Resend request failed');
  }

  return response.json();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/contact') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const body = await readBody(req);

    const name = sanitizeText(body.name, 120);
    const email = sanitizeText(body.email, 160).toLowerCase();
    const whatsapp = normalizePhone(body.whatsapp);
    const message = sanitizeText(body.message, 2000);

    if (!name || !email || !whatsapp) {
      return sendJson(res, 400, { error: 'Campos obrigatórios faltando.' });
    }

    if (!validateEmail(email)) {
      return sendJson(res, 400, { error: 'E-mail inválido.' });
    }

    if (whatsapp.length < 8) {
      return sendJson(res, 400, { error: 'WhatsApp inválido.' });
    }

    await sendEmailViaResend({ name, email, whatsapp, message });

    return sendJson(res, 200, { ok: true, message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error('Contact error:', error);
    return sendJson(res, 500, {
      error: error.message || 'Falha ao enviar mensagem.'
    });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
