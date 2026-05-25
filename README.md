# Zepto Wink Challenge 😉

> **Wink Fast, Save Big!** — A gamified discount experience built for Zepto.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/zepto-wink-challenge)

---

## 🎮 What Is It?

The **Zepto Wink Challenge** is a browser-based promotional game that uses your device's camera and real-time face tracking (via MediaPipe Face Mesh) to count how many times you wink in 45 seconds. Every wink earns a discount:

- **1 wink = 0.33% off** your next Zepto order
- **Up to 60% off** at max winks
- Only **single-eye winks** count — blinking both eyes together is ignored!

---

## ✨ Features

- 🎯 Real-time eye tracking via [MediaPipe Face Mesh](https://google.github.io/mediapipe/solutions/face_mesh)
- 📐 Auto-calibration to your unique eye shape (no manual tuning needed)
- 👁️ Robust wink detection: distinguishes single winks from double blinks
- ⏱️ 45-second countdown timer with live progress bar
- 🎁 Unique promo code generation based on wink count
- 📱 Mobile-friendly & responsive design
- 🔒 No video data is stored or transmitted — all processing is on-device

---

## 🚀 Quick Start (Local Development)

### Prerequisites

- [Node.js](https://nodejs.org/) v16+
- A webcam / front-facing camera

### Install & Run

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/zepto-wink-challenge.git
cd zepto-wink-challenge

# Install dependencies
npm install

# Start local HTTPS server (required for camera access)
npm run dev
```

Then open **`https://localhost:5000`** in your browser.  
> ⚠️ You'll see a self-signed certificate warning — click "Advanced → Proceed" to continue. This is expected in local dev.

### Test on Phone (Same Wi-Fi)

The server prints a **Network URL** (e.g. `https://192.168.x.x:5000`) — open that on your phone while on the same Wi-Fi network.

---

## ☁️ Deploy to Vercel (Production)

The app is pre-configured for **zero-config Vercel deployment** as a static site. Vercel provides HTTPS automatically, so the camera API works without any workarounds.

### Option A — One-Click Deploy

Click the button at the top of this README.

### Option B — Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

### Option C — GitHub Integration

1. Push this repo to GitHub
2. Go to [vercel.com/new](https://vercel.com/new)
3. Import your repository
4. Click **Deploy** — no build settings needed

---

## 🗂️ Project Structure

```
zepto-wink-challenge/
├── public/
│   ├── index.html        # Entire app (HTML + CSS + JS, single-file)
│   └── zepto-logo.png    # Zepto brand asset
├── server.js             # Local HTTPS dev server (not used on Vercel)
├── package.json
├── vercel.json           # Vercel static hosting config
├── .gitignore
└── README.md
```

---

## 🧠 How the Wink Detection Works

1. **MediaPipe Face Mesh** extracts 468 facial landmarks per frame at ~30fps.
2. The **Eye Aspect Ratio (EAR)** is computed for each eye using 6 landmark points:

   ```
   EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
   ```

3. **Auto-calibration** (3.5 s at game start) measures your personal open-eye EAR baseline.
4. **Wink criteria** (all must be true):
   - Target eye EAR drops below **85%** of its calibrated baseline
   - Opposite eye EAR stays above **75%** of its calibrated baseline
   - Both eyes are **not** closed simultaneously (double-blink guard)
   - Minimum **280 ms** cooldown between consecutive winks on the same eye
5. The wink is registered when the closed eye **reopens** (edge-triggered, not level-triggered).

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Face Tracking | MediaPipe Face Mesh (CDN) |
| Styling | Tailwind CSS (CDN) + Custom CSS |
| Fonts | Google Fonts — Orbitron, Inter |
| Local Server | Node.js + Express + selfsigned |
| Deployment | Vercel (static) |
| Runtime | Vanilla JS (no framework) |

---

## 📋 Requirements

> This project is **pure front-end** and has **no Python dependencies**.  
> The `requirements.txt` file is included for documentation purposes only.

See [`requirements.txt`](./requirements.txt) for the Node.js dependency list.

---

## 📄 License

MIT © Zepto / Demo Project
