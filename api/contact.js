const { readFileSync } = require('fs');

const getBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body) return {};

  try {
    return JSON.parse(body);
  } catch (error) {
    return {};
  }
};

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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    const body = await getBody(req);
    const name = sanitizeText(body.name, 120);
    const email = sanitizeText(body.email, 160).toLowerCase();
    const whatsapp = normalizePhone(body.whatsapp);
    const message = sanitizeText(body.message, 2000);

    if (!name || !email || !whatsapp) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Campos obrigatórios faltando.' }));
      return;
    }

    if (!validateEmail(email)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'E-mail inválido.' }));
      return;
    }

    if (whatsapp.length < 8) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'WhatsApp inválido.' }));
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const fromEmail = process.env.FROM_EMAIL || 'rbrandel@gmail.com.com';
    const toEmail = process.env.TO_EMAIL || 'rbrandel@gmail.com';

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: email,
        subject: `Contato Radar de IA - ${name}`,
        html: `
          <h3>Novo contato do Radar de IA</h3>
          <p><strong>Nome:</strong> ${name}</p>
          <p><strong>E-mail:</strong> ${email}</p>
          <p><strong>WhatsApp:</strong> ${whatsapp}</p>
          <p><strong>Mensagem:</strong><br>${message || 'Sem mensagem adicional.'}</p>
        `,
        text: `Novo contato do Radar de IA\n\nNome: ${name}\nE-mail: ${email}\nWhatsApp: ${whatsapp}\nMensagem: ${message || 'Sem mensagem adicional.'}`
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'Resend request failed');
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, message: 'Mensagem enviada com sucesso.' }));
  } catch (error) {
    console.error('Contact function error:', error);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error.message || 'Não foi possível enviar o e-mail.' }));
  }
};
