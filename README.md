# Remy AI — Home Inventory & Pantry Assistant

This project keeps the Remy v6 UI design and connects it to the existing Flask/SQLite/Groq backend features.

## Project structure

```text
Remy_AI_Professional_Project/
├── app.py                  # Flask backend + existing API routes/logic
├── requirements.txt
├── .env.example
├── .gitignore
├── inventory.db            # created automatically at first run (do not share)
├── uploads/
│   └── receipts/           # original receipt files
└── frontend/
    ├── index.html          # Remy v6 UI markup
    ├── css/
    │   └── styles.css      # extracted v6 styles
    └── js/
        └── app.js          # frontend behavior + API integration
```

## Setup (Windows PowerShell)

1. Extract the ZIP into a folder and open a terminal in that folder.
2. Create a virtual environment:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

3. Install packages:

   ```powershell
   python -m pip install -r requirements.txt
   ```

4. Create `.env` from `.env.example`, then set a **new** Groq API key. If `.env` is not auto-loaded in your environment, use:

   ```powershell
   $env:GROQ_API_KEY="YOUR_NEW_GROQ_API_KEY"
   ```

5. Start Flask:

   ```powershell
   python app.py
   ```

6. Open `http://127.0.0.1:5000`

7. Check backend status at `http://127.0.0.1:5000/api/health`.

## Features retained/connected

- Flask + SQLite inventory and additive DB migrations
- Three item types: Food, Household, Asset
- Product image upload/camera capture (front/back/etc.) and AI scan/review
- Barcode/QR decoding via ZXing-C++ and Open Food Facts lookup (coverage not guaranteed)
- Editable item details and inventory saving
- Shopping list database CRUD
- Receipt image extraction, review, add extracted item to inventory
- Receipt Vault stores original image/PDF files and metadata in SQLite + `uploads/receipts/`
- View/download/delete saved receipts
- Remy AI chat with current inventory context and dietary recipe mode
- Expiry/warranty fields, item quantity/unit/price/storage, brand/barcode/notes

## Important notes

- **AI features require a Groq API key** and model access. The project does not include a key.
- Product vision can inspect up to three images per AI request (the backend accepts up to six images and uses barcode decoding across them). It cannot guarantee that every barcode/QR or expiry date is readable.
- Receipt AI extraction currently supports image files (JPG/PNG/WEBP). PDF receipts can be stored in the Receipt Vault but are not AI-extracted by this backend.
- The current backend validation requires expiry dates for food and household items. Assets may use an optional warranty date.
- The database is created at project root. Back up `inventory.db` together with `uploads/receipts/` before moving the app.
- Never commit `.env`, `inventory.db`, or private receipts.
- This is a local development Flask app, not production deployment. Before public deployment, add authentication, CSRF protections, upload hardening, and a production WSGI server.

## Backend API routes

- `GET /api/inventory`, `POST /api/inventory`, `DELETE /api/inventory/<id>`
- `POST /api/analyze_images` (legacy `POST /api/analyze_image` also retained)
- `GET /api/shopping`, `POST /api/shopping`, `DELETE /api/shopping/<id>`
- `POST /api/analyze_receipt`
- `GET /api/receipts`, `POST /api/receipts`
- `GET /api/receipts/<id>/file` (supports `?download=1`)
- `DELETE /api/receipts/<id>`
- `POST /api/chat`
- `GET /api/health`
