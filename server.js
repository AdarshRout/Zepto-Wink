'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const selfsigned = require('selfsigned');

// ─── Generate self-signed certificate ────────────────────────────────────────
const attrs = [{ name: 'commonName', value: 'zepto-wink-local' }];
const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
});

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Fallback: serve index.html for any unknown route
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── HTTPS server ─────────────────────────────────────────────────────────────
const server = https.createServer(
  { key: pems.private, cert: pems.cert },
  app
);

const PORT = 5000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  // Detect local Wi-Fi IP address
  const nets = os.networkInterfaces();
  let localIp = '127.0.0.1';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Pick first external IPv4 address (non-loopback)
      if (net.family === 'IPv4' && !net.internal) {
        localIp = net.address;
        break;
      }
    }
  }

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        🟡 ZEPTO WINK CHALLENGE - SERVER UP 🟣        ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Local:   https://localhost:${PORT}                    ║`);
  console.log(`║  Network: https://${localIp}:${PORT}              ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  ⚠  Accept the self-signed cert warning in browser  ║');
  console.log('║  📱 Open the Network URL on your phone (same Wi-Fi)  ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('\n');
});
