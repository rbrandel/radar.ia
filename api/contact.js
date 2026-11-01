module.exports = async (req, res) => {
  const setJson = (statusCode, payload) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'OPTIONS') {
    setJson(200, { ok: true });
    return;
  }

  if (req.method !== 'POST') {
    setJson(404, { error: 'Not found' });
    return;
  }

  try {
    let body = {};
    if (req.body) {
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (error) {
          body = {};
        }
      } else if (typeof req.body === 'object') {
        body = req.body;
      }
    } else {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (error) {
          body = {};
        }
      }
    }

    const sanitizeText = (value, maxLength = 2000) => {
      return String(value ?? '')
        .replace(/[<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
    };

    const normalizePhone = (value) => {
      return String(value ?? '')
        .replace(/[^\d+\-\s()]/g, '')
        .trim();
    };

    const validateEmail = (email) => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
    };

    const name = sanitizeText(body.name, 120);
    const email = sanitizeText(body.email, 160).toLowerCase();
    const whatsapp = normalizePhone(body.whatsapp);
    const message = sanitizeText(body.message, 2000);

    if (!name || !email || !whatsapp) {
      setJson(400, { error: 'Campos obrigatórios faltando.' });
      return;
    }

    if (!validateEmail(email)) {
      setJson(400, { error: 'E-mail inválido.' });
      return;
    }

    if (whatsapp.length < 8) {
      setJson(400, { error: 'WhatsApp inválido.' });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    const fromEmail = process.env.FROM_EMAIL || 'rbrandel@gmail.com';
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
      const errorText = await response.text();
      throw new Error(errorText || 'Resend request failed');
    }

    setJson(200, { ok: true, message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error('Contact API error:', error);
    setJson(500, {
      error: error.message || 'Não foi possível enviar o e-mail.'
    });
  }
};
