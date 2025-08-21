import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';
import { z } from 'zod';

const app = express();
const PORT = process.env.PORT || 8080;

// ===== Security & CORS =====
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // allow curl/postman
    if (allowed.length === 0 || allowed.includes(origin)) return cb(null, true);
    cb(new Error('CORS blocked'));
  }
}));

// ===== Rate limit =====
const limiter = rateLimit({
  windowMs: 60_000, // 1 min
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/v1/', limiter);

// ===== Health =====
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nazpar-backend', time: new Date().toISOString() });
});

// ===== Validate payload =====
const ChatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system','user','assistant']),
    content: z.string().min(1).max(8000)
  })).min(1),
  model: z.string().optional()
});

// ===== Chat endpoint =====
app.post('/v1/chat', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Server misconfigured: missing OPENAI_API_KEY' });
    }

    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', detail: parsed.error.flatten() });
    }

    const model = req.body.model || 'gpt-4o-mini';
    const systemPrefix = {
      role: 'system',
      content:
        "You are Nazpar, a world-class Persian assistant for brand 'Javad&Yavar Design'. " +
        "Be warm, concise, and helpful. Answer in Persian (fa) by default. " +
        "If user requests code, return minimal, correct, production-ready code."
    };

    const payload = {
      model,
      messages: [systemPrefix, ...parsed.data.messages],
      temperature: 0.6
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: 'Upstream error', detail: text });
    }

    const data = await r.json();
    const reply = data?.choices?.[0]?.message?.content || '';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`Nazpar backend running on :${PORT}`);
});