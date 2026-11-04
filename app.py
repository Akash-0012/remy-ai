import os

import re

import io

import json

import base64

import sqlite3

import requests

from datetime import datetime

from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, send_file

from PIL import Image, ImageOps

try:

    from dotenv import load_dotenv

    load_dotenv()

except ImportError:

    pass

try:

    import zxing_cpp

except ImportError:

    zxing_cpp = None

app = Flask(__name__, static_folder="frontend", static_url_path="/static")

app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB request limit

# Set GROQ_API_KEY in your environment, or paste a NEW key below.

# Do not reuse a key that has been exposed in chat or committed to GitHub.

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

TEXT_MODEL = "openai/gpt-oss-20b"

VISION_MODEL = os.environ.get("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")

DB_NAME = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inventory.db")

REQUEST_TIMEOUT = (20, 120)  # connect timeout, response timeout

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "receipts")

os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_RECEIPT_BYTES = 12 * 1024 * 1024

# Optional locally curated barcode mapping. Add products you identify once here.

KNOWN_PRODUCTS = {

    "8901524000670": {"name": "Ahaar Chana Flour", "brand": "Ahaar", "category": "General", "barcode": "8901524000670"}

}

# Suggested locations are not a whitelist; custom user-entered locations are supported.
DEFAULT_LOCATIONS = {"Fridge", "Pantry", "Freezer", "Spice Rack"}

# ------------------------------ Database ------------------------------

def get_db_connection():

    conn = sqlite3.connect(DB_NAME)

    conn.row_factory = sqlite3.Row

    return conn

def init_db():

    conn = get_db_connection()

    try:

        conn.execute("""

            CREATE TABLE IF NOT EXISTS products (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                name TEXT NOT NULL,

                category TEXT NOT NULL,

                expiryDate TEXT NOT NULL,

                addedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            )

        """)

        # Migrate existing databases without deleting saved inventory.

        product_columns = {

            row["name"] for row in conn.execute("PRAGMA table_info(products)")

        }

        if "location" not in product_columns:

            conn.execute("ALTER TABLE products ADD COLUMN location TEXT NOT NULL DEFAULT 'Pantry'")

        if "quantity" not in product_columns:

            conn.execute("ALTER TABLE products ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1")

        # New item types and household inventory fields. These migrations are additive

        # and preserve all existing inventory rows.

        additions = {

            "itemType": "TEXT NOT NULL DEFAULT 'food'",

            "unit": "TEXT NOT NULL DEFAULT 'pcs'",

            "price": "REAL",

            "brand": "TEXT NOT NULL DEFAULT ''",

            "barcode": "TEXT NOT NULL DEFAULT ''",

            "warrantyDate": "TEXT NOT NULL DEFAULT ''",

            "notes": "TEXT NOT NULL DEFAULT ''",

        }

        for column, definition in additions.items():

            if column not in product_columns:

                conn.execute(f"ALTER TABLE products ADD COLUMN {column} {definition}")

        conn.execute("""

            CREATE TABLE IF NOT EXISTS receipts (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                store TEXT DEFAULT '',

                receipt_date TEXT DEFAULT '',

                total REAL,

                original_name TEXT NOT NULL,

                stored_name TEXT NOT NULL UNIQUE,

                mime_type TEXT NOT NULL,

                file_size INTEGER NOT NULL DEFAULT 0,

                extracted_json TEXT DEFAULT '{}',

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            )

        """)

        conn.execute("""

            CREATE TABLE IF NOT EXISTS barcode_products (

                barcode TEXT PRIMARY KEY,

                name TEXT NOT NULL,

                brand TEXT DEFAULT '',

                category TEXT DEFAULT 'General',

                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            )

        """)

        conn.execute("""

            CREATE TABLE IF NOT EXISTS shopping_items (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                name TEXT NOT NULL,

                quantity INTEGER NOT NULL DEFAULT 1,

                category TEXT NOT NULL DEFAULT 'General',

                addedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP

            )

        """)

        conn.commit()

    finally:

        conn.close()

# ------------------------------ Groq API ------------------------------

def call_groq(messages, model=TEXT_MODEL, max_tokens=1200):

    if not GROQ_API_KEY:

        raise RuntimeError("Groq API key is not configured. Add a new key to app.py or set GROQ_API_KEY.")

    response = requests.post(

        GROQ_URL,

        headers={

            "Authorization": f"Bearer {GROQ_API_KEY}",

            "Content-Type": "application/json",

        },

        json={

            "model": model,

            "messages": messages,

            "max_completion_tokens": max_tokens,

        },

        timeout=REQUEST_TIMEOUT,

    )

    if not response.ok:

        # Avoid logging headers or secrets.

        print(f"Groq API error [{response.status_code}]: {response.text[:1200]}")

        if response.status_code == 429:

            raise RuntimeError("Groq quota or rate limit reached. Check your Groq Console usage limits.")

        if response.status_code in (401, 403):

            raise RuntimeError("Groq authentication failed. Check your API key and model access.")

        if response.status_code == 404:

            raise RuntimeError("Groq model not found or unavailable to your account. Check the current Groq model list.")

        raise RuntimeError(f"Groq API returned HTTP {response.status_code}.")

    payload = response.json()

    choices = payload.get("choices", [])

    if not choices:

        raise RuntimeError("Groq returned no response choices.")

    content = choices[0].get("message", {}).get("content", "")

    if not isinstance(content, str) or not content.strip():

        raise RuntimeError("Groq returned an empty response.")

    return content.strip()

def error_response(exc):

    message = str(exc)

    print(f"Application error: {message}")

    if "quota or rate limit" in message:

        return jsonify({"error": message}), 429

    if "timed out" in message.lower():

        return jsonify({"error": "The AI service timed out. Please try again."}), 504

    if "authentication failed" in message or "model not found" in message:

        return jsonify({"error": message}), 502

    if "API key is not configured" in message:

        return jsonify({"error": message}), 503

    return jsonify({"error": message}), 502

# ------------------------------ Utilities ------------------------------

def clean_image_data(image):

    """Accept {imageBase64, mimeType} and normalize data URLs."""

    if not isinstance(image, dict):

        raise ValueError("Each image must include imageBase64 and mimeType.")

    raw = image.get("imageBase64") or image.get("data")

    mime = image.get("mimeType") or "image/jpeg"

    if not isinstance(raw, str) or not raw.strip():

        raise ValueError("One of the selected photos is empty.")

    raw = raw.strip()

    if raw.startswith("data:"):

        try:

            header, raw = raw.split(",", 1)

            mime = header.split(";", 1)[0].replace("data:", "")

        except ValueError:

            raise ValueError("Invalid image data URL.")

    if not mime.startswith("image/"):

        raise ValueError("Only image files are supported.")

    return raw, mime

def valid_date(value):

    if not isinstance(value, str):

        return False

    try:

        datetime.strptime(value, "%Y-%m-%d")

        return True

    except ValueError:

        return False

# ------------------------------ Image / barcode / receipt helpers ------------------------------

def optimize_image_bytes(raw_bytes, max_side=1800, quality=88):

    """Resize large images for vision while preserving label detail and aspect ratio."""

    with Image.open(io.BytesIO(raw_bytes)) as im:

        im = ImageOps.exif_transpose(im).convert("RGB")

        # Avoid unnecessarily shrinking already-small product labels.

        im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

        out = io.BytesIO()

        im.save(out, format="JPEG", quality=quality, optimize=True)

        return out.getvalue()

def decode_barcode(raw_bytes):

    """Try QR/EAN/UPC decoding on original and enhanced image variants."""

    if zxing_cpp is None:

        return ""

    try:

        with Image.open(io.BytesIO(raw_bytes)) as source:

            base = ImageOps.exif_transpose(source).convert("RGB")

            variants = [base]

            # Small/low-contrast barcodes often decode better after enlargement.

            if max(base.size) < 1800:

                variants.append(base.resize((base.width * 2, base.height * 2), Image.Resampling.LANCZOS))

            gray = ImageOps.grayscale(base)

            variants.append(ImageOps.autocontrast(gray))

            variants.append(ImageOps.autocontrast(gray).resize(

                (gray.width * 2, gray.height * 2), Image.Resampling.LANCZOS))

            for variant in variants:

                try:

                    results = zxing_cpp.read_barcodes(variant)

                    for result in results:

                        value = getattr(result, "text", "")

                        if value and value.strip():

                            return value.strip()

                except Exception:

                    continue

    except Exception:

        app.logger.exception("Barcode/QR decoding failed")

    return ""

def lookup_barcode(barcode):

    if not barcode:

        return None

    conn = get_db_connection()

    try:

        row = conn.execute("SELECT * FROM barcode_products WHERE barcode=?", (barcode,)).fetchone()

        if row:

            return dict(row)

    finally:

        conn.close()

    if barcode in KNOWN_PRODUCTS:

        return dict(KNOWN_PRODUCTS[barcode])

    try:

        r = requests.get(f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json",

                        headers={"User-Agent": "RemyAI/1.0 (local household inventory)"}, timeout=(5, 10))

        if r.ok:

            data = r.json()

            product = data.get("product") or {}

            if data.get("status") == 1 and product:

                name = product.get("product_name") or product.get("product_name_en") or ""

                brand = product.get("brands") or ""

                if name:

                    return {"barcode": barcode, "name": name, "brand": brand, "category": "General", "source": "Open Food Facts"}

    except requests.RequestException:

        app.logger.info("Open Food Facts lookup unavailable for barcode %s", barcode)

    return None

def extract_data_url(data_url):

    if not isinstance(data_url, str) or "," not in data_url:

        raise ValueError("Please select a valid receipt or product image.")

    header, encoded = data_url.split(",", 1)

    mime = header.split(";")[0].replace("data:", "")

    raw = base64.b64decode(encoded)

    if len(raw) > MAX_RECEIPT_BYTES:

        raise ValueError("File is too large. Please choose a file under 12 MB.")

    return raw, mime

def parse_json_response(text):

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip(), flags=re.I)

    match = re.search(r"\{.*\}", cleaned, flags=re.S)

    if not match:

        raise ValueError("AI did not return valid structured details.")

    return json.loads(match.group(0))

# ------------------------------ Frontend ------------------------------

@app.route("/")

def index():

    return send_from_directory(os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend"), "index.html")

@app.route("/api/health", methods=["GET"])

def health():

    return jsonify({

        "ok": True,

        "database": os.path.isfile(DB_NAME),

        "groq_configured": bool(GROQ_API_KEY),

        "text_model": TEXT_MODEL,

        "vision_model": VISION_MODEL,

        "barcode_decoder_available": zxing_cpp is not None,

    })

# ------------------------------ Inventory API ------------------------------

@app.route("/api/inventory", methods=["GET"])

def get_inventory():

    conn = get_db_connection()

    try:

        rows = conn.execute("SELECT * FROM products ORDER BY CASE WHEN expiryDate='' THEN 1 ELSE 0 END, expiryDate ASC, name ASC").fetchall()

        return jsonify([dict(row) for row in rows])

    finally:

        conn.close()

@app.route("/api/inventory", methods=["POST"])

def add_product():

    data = request.get_json(silent=True) or {}

    name = data.get("name")

    category = str(data.get("category", "General"))[:60]

    expiry_date = data.get("expiryDate") or ""

    location = data.get("location", "Pantry")

    quantity = data.get("quantity", 1)

    item_type = data.get("itemType", "food")

    unit = str(data.get("unit") or "pcs")[:24]

    brand = str(data.get("brand") or "")[:120]

    barcode = str(data.get("barcode") or "")[:80]

    warranty_date = data.get("warrantyDate") or ""

    notes = str(data.get("notes") or "")[:500]

    price = data.get("price")

    if not isinstance(name, str) or not name.strip():

        return jsonify({"error": "Product name is required."}), 400

    if item_type not in ("food", "household", "asset"):

        return jsonify({"error": "Choose Food, Household, or Asset type."}), 400

    allowed_categories = {
        "food": {"General", "Produce"},
        "household": {"Personal Care", "Cleaning", "Household"},
        "asset": {"Asset"},
    }
    if category not in allowed_categories[item_type]:
        category = {"food": "General", "household": "Household", "asset": "Asset"}[item_type]

    # Food expiry is required. Household expiry is optional if not printed.
    if item_type == "food" and not valid_date(expiry_date):
        return jsonify({"error": "Please enter a valid expiry date for food products."}), 400
    if item_type == "household" and expiry_date and not valid_date(expiry_date):
        return jsonify({"error": "Expiry date must be YYYY-MM-DD, or blank if unavailable."}), 400

    if item_type == "asset" and warranty_date and not valid_date(warranty_date):

        return jsonify({"error": "Warranty date must be YYYY-MM-DD."}), 400

    if not isinstance(location, str):
        return jsonify({"error": "Location must be text."}), 400
    location = location.strip()[:120]
    if not location:
        return jsonify({"error": "Please enter or select a location."}), 400

    try:

        quantity = int(quantity)

    except (TypeError, ValueError):

        return jsonify({"error": "Quantity must be a whole number."}), 400

    if quantity < 1 or quantity > 100000:

        return jsonify({"error": "Quantity must be between 1 and 100000."}), 400

    if price not in (None, ""):

        try:

            price = float(price)

            if price < 0 or price > 100000000:

                raise ValueError

        except (TypeError, ValueError):

            return jsonify({"error": "Price must be a valid non-negative amount."}), 400

    else:

        price = None

    conn = get_db_connection()

    try:

        cur = conn.execute(

            """INSERT INTO products

               (name, category, expiryDate, location, quantity, itemType, unit, price, brand, barcode, warrantyDate, notes)

               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",

            (name.strip(), category, expiry_date, location, quantity, item_type, unit, price, brand, barcode, warranty_date, notes),

        )

        conn.commit()

        row = conn.execute("SELECT * FROM products WHERE id = ?", (cur.lastrowid,)).fetchone()

        return jsonify({"status": "success", "product": dict(row)}), 201

    finally:

        conn.close()

@app.route("/api/inventory/<int:product_id>", methods=["DELETE"])

def delete_product(product_id):

    conn = get_db_connection()

    try:

        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()

        if row is None:

            return jsonify({"error": "Product not found."}), 404

        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))

        conn.commit()

        return jsonify({"status": "success", "deleted": dict(row)})

    finally:

        conn.close()

# ------------------------------ Shopping list API ------------------------------

@app.route("/api/shopping", methods=["GET"])

def get_shopping_list():

    conn = get_db_connection()

    try:

        rows = conn.execute("SELECT * FROM shopping_items ORDER BY addedAt DESC, id DESC").fetchall()

        return jsonify([dict(row) for row in rows])

    finally:

        conn.close()

@app.route("/api/shopping", methods=["POST"])

def add_shopping_item():

    data = request.get_json(silent=True) or {}

    name = data.get("name")

    category = data.get("category", "General")

    quantity = data.get("quantity", 1)

    if not isinstance(name, str) or not name.strip():

        return jsonify({"error": "Shopping item name is required."}), 400

    try:

        quantity = max(1, int(quantity))

    except (TypeError, ValueError):

        return jsonify({"error": "Quantity must be a whole number."}), 400

    conn = get_db_connection()

    try:

        cur = conn.execute(

            "INSERT INTO shopping_items (name, quantity, category) VALUES (?, ?, ?)",

            (name.strip(), str(category)[:60], quantity),

        )

        conn.commit()

        row = conn.execute("SELECT * FROM shopping_items WHERE id = ?", (cur.lastrowid,)).fetchone()

        return jsonify({"status": "success", "item": dict(row)}), 201

    finally:

        conn.close()

@app.route("/api/shopping/<int:item_id>", methods=["DELETE"])

def delete_shopping_item(item_id):

    conn = get_db_connection()

    try:

        cur = conn.execute("DELETE FROM shopping_items WHERE id = ?", (item_id,))

        conn.commit()

        if cur.rowcount == 0:

            return jsonify({"error": "Shopping item not found."}), 404

        return jsonify({"status": "success"})

    finally:

        conn.close()

# ------------------------------ Multi-photo AI scanning ------------------------------

@app.route("/api/analyze_images", methods=["POST"])

def analyze_images():

    data = request.get_json(silent=True) or {}

    images = data.get("images", [])

    if not isinstance(images, list) or not images:

        # Backwards compatibility with the earlier one-image endpoint.

        if data.get("imageBase64"):

            images = [{

                "imageBase64": data.get("imageBase64"),

                "mimeType": data.get("mimeType", "image/jpeg"),

            }]

        else:

            return jsonify({"error": "Select at least one photo to scan."}), 400

    if len(images) > 6:

        return jsonify({"error": "You can scan up to 6 photos at once."}), 400

    req_type = data.get("type", "both")

    item_type = data.get("itemType", "food")

    if req_type in ("food", "household", "asset"):

        item_type = req_type

        req_type = "both"

    if item_type not in ("food", "household", "asset"):

        item_type = "food"

    if req_type not in ("name", "expiry", "both"):

        return jsonify({"error": "Invalid scan type."}), 400

    try:

        barcode = ""

        first_raw = None

        for image_obj in images:

            encoded, mime = clean_image_data(image_obj)

            raw = base64.b64decode(encoded)

            if first_raw is None:

                first_raw = raw

            barcode = decode_barcode(raw)

            if barcode:

                break

        barcode_lookup_code = barcode

        if barcode and not re.fullmatch(r"(?:\d{8}|\d{12,14})", barcode):

            # QR codes may contain a product URL or structured payload with a GTIN.

            gtin_match = re.search(r"(?<!\d)(\d{8}|\d{12,14})(?!\d)", barcode)

            barcode_lookup_code = gtin_match.group(1) if gtin_match else ""

        barcode_product = lookup_barcode(barcode_lookup_code) if barcode_lookup_code else None

        content = [{

            "type": "text",

            "text": (

                "Analyze all attached photos as photos of the SAME product. Carefully read package text, brand, product name, expiry/best-before dates, quantity/size, and any printed manufacturing/expiry labels. "

                "They may show different package sides, barcode, QR code, or expiry label. "

                "Return only valid JSON with keys name, brand, category, itemType, expiryDate, quantity, unit, price, barcode. "

                "itemType must be food, household, or asset. Requested item type: " + item_type + ". "

                "Classify edible groceries as food; toiletries, shampoo, cosmetics, toothpaste and cleaning products as household; durable appliances/equipment as asset. "

                "category should be Produce or General for food, Personal Care/Cleaning/Household for household, and Asset for assets. "

                "expiryDate must be YYYY-MM-DD or empty. Convert clearly printed dates to YYYY-MM-DD; do not guess. If date is absent or unreadable, return empty. "

                "Use the visible product name; use Unknown Item only if it cannot be identified. "

                "Today's date is " + datetime.now().strftime("%Y-%m-%d") + ". "

                "Task requested: " + req_type + "."

            ),

        }]

        for item in images[:3]:  # vision provider accepts up to 3 image inputs

            encoded, mime = clean_image_data(item)

            raw_bytes = base64.b64decode(encoded)

            optimized = optimize_image_bytes(raw_bytes)

            optimized_b64 = base64.b64encode(optimized).decode("ascii")

            content.append({

                "type": "image_url",

                "image_url": {"url": f"data:image/jpeg;base64,{optimized_b64}"},

            })

        text = call_groq(

            [{"role": "user", "content": content}],

            model=VISION_MODEL,

            max_tokens=400,

        )

        # Parse model JSON safely, allowing optional code fences.

        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip(), flags=re.I)

        match = re.search(r"\{.*\}", cleaned, flags=re.S)

        if match:

            import json

            parsed = json.loads(match.group(0))

            name = str(parsed.get("name") or "").strip()

            if not name or name.lower() in {"unknown item", "unknown", "n/a"}:

                name = str((barcode_product or {}).get("name") or "").strip()

            category = (barcode_product or {}).get("category") or parsed.get("category")

            expiry = str(parsed.get("expiryDate") or "").strip()

            detected_type = str(parsed.get("itemType") or item_type).strip().lower()

            if detected_type not in ("food", "household", "asset"):

                detected_type = item_type

            allowed_categories = {"Produce", "General", "Personal Care", "Cleaning", "Household", "Asset"}

            if category not in allowed_categories:

                category = "Produce" if item_type == "food" and str(parsed.get("category", "")).lower() == "produce" else ("Asset" if item_type == "asset" else "General")

            if not valid_date(expiry):

                expiry = ""

            return jsonify({

                "name": name,

                "quantity": str(parsed.get("quantity") or ""),

                "unit": str(parsed.get("unit") or ""),

                "price": parsed.get("price") if parsed.get("price") not in ("", None) else "",

                "brand": str((barcode_product or {}).get("brand") or parsed.get("brand") or ""),

                "barcode": barcode,

                "barcodeFound": bool(barcode),

                "identifiedBy": (barcode_product or {}).get("source", "barcode database" if barcode_product else "vision/manual"),

                "identificationStatus": "identified" if name else "manual_required",

                "message": "Product identified. Review details." if name else "Could not identify product automatically. Enter the name manually; barcode has been retained.",

                "category": category,

                "itemType": detected_type,

                "expiryDate": expiry,

                "raw": text,

            })

        return jsonify({

            "error": "The AI response could not be parsed. Try a clearer photo.",

            "raw": text,

        }), 502

    except ValueError as exc:

        return jsonify({"error": str(exc)}), 400

    except requests.Timeout:

        return jsonify({"error": "Image scan timed out. Please try again."}), 504

    except requests.RequestException:

        app.logger.exception("Image scan connection failed")

        return jsonify({"error": "Could not connect to the AI service."}), 502

    except Exception as exc:

        return error_response(exc)

# Keep the old endpoint available for any older frontend code.

@app.route("/api/analyze_image", methods=["POST"])

def analyze_image_legacy():

    data = request.get_json(silent=True) or {}

    req_type = data.get("type", "name")

    data["images"] = [{

        "imageBase64": data.get("imageBase64"),

        "mimeType": data.get("mimeType", "image/jpeg"),

    }]

    data["type"] = req_type

    with app.test_request_context(json=data):

        return analyze_images()

# ------------------------------ Receipt Vault API ------------------------------

@app.route("/api/analyze_receipt", methods=["POST"])

def analyze_receipt():

    data = request.get_json(silent=True) or {}

    images = data.get("images") or []

    if not images and data.get("imageBase64"):

        images = [{"imageBase64": data.get("imageBase64"), "mimeType": data.get("mimeType", "image/jpeg")}]

    if not images:

        return jsonify({"error": "Choose a receipt image or PDF (image format supported for AI scan)."}), 400

    if len(images) > 3:

        return jsonify({"error": "Upload at most 3 receipt images per scan."}), 400

    try:

        content = [{"type": "text", "text": "Read this receipt carefully. Return ONLY JSON with keys store, receiptDate (YYYY-MM-DD or empty), total (number or null), currency, items (array of objects with name, quantity, unit, unitPrice, totalPrice, itemType). itemType must be food, household, or asset. Classify toothpaste, shampoo, cosmetics, toiletries, cleaning products, and similar non-food consumables as household; groceries and edible products as food; durable goods as asset. Do not invent unreadable values; use empty strings or null. Today's date: " + datetime.now().strftime("%Y-%m-%d")}]

        for item in images:

            encoded, mime = clean_image_data(item)

            raw = base64.b64decode(encoded)

            optimized = optimize_image_bytes(raw, max_side=1600, quality=85)

            content.append({"type":"image_url", "image_url":{"url":"data:image/jpeg;base64,"+base64.b64encode(optimized).decode("ascii")}})

        answer = call_groq([{"role":"user","content":content}], model=VISION_MODEL, max_tokens=1200)

        result = parse_json_response(answer)

        result.setdefault("store", "")

        result.setdefault("receiptDate", "")

        result.setdefault("total", None)

        result.setdefault("items", [])

        return jsonify(result)

    except requests.Timeout:

        return jsonify({"error":"Receipt scan timed out. Try a smaller/clearer image."}), 504

    except Exception as exc:

        return error_response(exc)

@app.route("/api/receipts", methods=["GET"])

def list_receipts():

    conn = get_db_connection()

    try:

        rows = conn.execute("SELECT id, store, receipt_date, total, original_name, mime_type, file_size, created_at FROM receipts ORDER BY id DESC").fetchall()

        return jsonify([dict(row) for row in rows])

    finally:

        conn.close()

@app.route("/api/receipts", methods=["POST"])

def save_receipt():

    data = request.get_json(silent=True) or {}

    try:

        raw, mime = extract_data_url(data.get("fileData"))

        if mime not in {"image/jpeg", "image/png", "image/webp", "application/pdf"}:

            return jsonify({"error":"Receipt must be JPG, PNG, WEBP, or PDF."}), 400

        original_name = str(data.get("fileName") or "receipt")[:240]

        suffix = {"image/jpeg":".jpg", "image/png":".png", "image/webp":".webp", "application/pdf":".pdf"}.get(mime, ".bin")

        stored_name = datetime.now().strftime("receipt_%Y%m%d_%H%M%S_") + os.urandom(4).hex() + suffix

        path = os.path.join(UPLOAD_DIR, stored_name)

        with open(path, "wb") as f:

            f.write(raw)

        details = data.get("details") or {}

        try:

            total = float(details.get("total")) if details.get("total") not in (None, "") else None

        except (TypeError, ValueError):

            total = None

        conn = get_db_connection()

        try:

            cur = conn.execute("INSERT INTO receipts (store, receipt_date, total, original_name, stored_name, mime_type, file_size, extracted_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",

                (str(details.get("store") or "")[:200], str(details.get("receiptDate") or "")[:20], total, original_name, stored_name, mime, len(raw), json.dumps(details, ensure_ascii=False)))

            conn.commit()

            receipt_id = cur.lastrowid

        finally:

            conn.close()

        return jsonify({"status":"saved", "id":receipt_id, "message":"Receipt saved to Receipt Vault."}), 201

    except ValueError as exc:

        return jsonify({"error":str(exc)}), 400

    except Exception as exc:

        app.logger.exception("Receipt save failed")

        return jsonify({"error":"Could not save receipt."}), 500

@app.route("/api/receipts/<int:receipt_id>/file", methods=["GET"])

def receipt_file(receipt_id):

    conn = get_db_connection()

    try:

        row = conn.execute("SELECT * FROM receipts WHERE id=?", (receipt_id,)).fetchone()

        if row is None:

            return jsonify({"error":"Receipt not found."}), 404

        path = os.path.join(UPLOAD_DIR, row["stored_name"])

        if not os.path.isfile(path):

            return jsonify({"error":"Receipt file is missing from storage."}), 404

        return send_file(path, mimetype=row["mime_type"], as_attachment=request.args.get("download") == "1", download_name=row["original_name"])

    finally:

        conn.close()

@app.route("/api/receipts/<int:receipt_id>", methods=["DELETE"])

def delete_receipt(receipt_id):

    conn = get_db_connection()

    try:

        row = conn.execute("SELECT stored_name FROM receipts WHERE id=?", (receipt_id,)).fetchone()

        if not row:

            return jsonify({"error":"Receipt not found."}), 404

        conn.execute("DELETE FROM receipts WHERE id=?", (receipt_id,))

        conn.commit()

        path = os.path.join(UPLOAD_DIR, row["stored_name"])

        if os.path.isfile(path):

            os.remove(path)

        return jsonify({"status":"deleted"})

    finally:

        conn.close()

# ------------------------------ Chat / dietary recipes ------------------------------

@app.route("/api/chat", methods=["POST"])

def chat():

    data = request.get_json(silent=True) or {}

    prompt = data.get("prompt", "")

    inventory = data.get("inventory", [])

    deleted_items = data.get("deletedItems", [])

    is_recipe = bool(data.get("isRecipe", False))

    dietary = data.get("dietary", "None")

    if not isinstance(prompt, str) or not prompt.strip():

        return jsonify({"error": "Please enter a message."}), 400

    if not isinstance(inventory, list) or not isinstance(deleted_items, list):

        return jsonify({"error": "Inventory data is invalid."}), 400

    if dietary not in {"None", "Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free", "Keto"}:

        dietary = "None"

    today = datetime.now().strftime("%Y-%m-%d")

    inventory_lines = []

    for item in inventory:

        if isinstance(item, dict):

            inventory_lines.append(

                f"- {item.get('name', 'Unknown')} | category: {item.get('category', 'General')} "

                f"| expires: {item.get('expiryDate', 'Unknown')} | location: {item.get('location', 'Pantry')} "

                f"| quantity: {item.get('quantity', 1)} {item.get('unit', 'pcs')} "

                f"| item type: {item.get('itemType', 'food')} | price: {item.get('price', 'unknown')} "

                f"| warranty: {item.get('warrantyDate', 'not applicable')}"

            )

    inventory_text = "\n".join(inventory_lines) or "(Empty)"

    deleted_lines = [

        f"- {item.get('name', 'Unknown')}" for item in deleted_items if isinstance(item, dict)

    ]

    deleted_text = "\n".join(deleted_lines) or "(Empty)"

    if is_recipe:

        system_prompt = f"""

You are Remy AI, a friendly household inventory and everyday assistant. You answer general questions, inventory and expiry questions, storage and shopping-list questions, and food/recipe questions. You are not limited to recipes.

Today's date: {today}

Current inventory:

{inventory_text}

Dietary preference: {dietary}

Generate 3 practical recipes that respect this dietary preference.

Prioritize items expiring soon, but never claim expired food is safe.

List ingredients, simple steps, and which inventory items each recipe uses.

If the inventory is empty, say so and offer pantry-friendly suggestions.

Return simple HTML only using tags such as <p>, <strong>, <ul>, <li>, and <ol>.

Do not use Markdown. Do not invent inventory quantities or expiry dates.

"""

    else:

        system_prompt = f"""

You are Remy AI, a friendly general assistant for household inventory, food and non-food products, expiry/warranty tracking, storage, shopping lists, and everyday questions. You are not limited to cooking or recipes.

Today's date: {today}

Current inventory:

{inventory_text}

Deleted/used items log:

{deleted_text}

When asked about expired products, compare valid YYYY-MM-DD dates to today's date.

An item is past its expiry date if the date is earlier than today.

Never invent products or dates. For shopping list questions, use the deleted/used log.

Give clear storage advice and use simple HTML only: <p>, <strong>, <ul>, <li>.

Do not use Markdown.

"""

    try:

        answer = call_groq(

            [

                {"role": "system", "content": system_prompt},

                {"role": "user", "content": prompt.strip()},

            ],

            model=TEXT_MODEL,

            max_tokens=1400,

        )

        return jsonify({"text": answer})

    except requests.Timeout:

        return jsonify({"error": "The AI assistant timed out. Please try again."}), 504

    except requests.RequestException:

        app.logger.exception("Chat connection failed")

        return jsonify({"error": "Could not connect to the AI service."}), 502

    except Exception as exc:

        return error_response(exc)

@app.errorhandler(413)

def request_too_large(_error):

    return jsonify({"error": "The uploaded photos are too large. Choose smaller images."}), 413

if __name__ == "__main__":

    init_db()

    print("=========================================")

    print("Remy database initialized successfully.")

    print("AI provider: Groq")

    print("Chat model:", TEXT_MODEL)

    print("Vision model:", VISION_MODEL)

    print("Access: http://127.0.0.1:5000")

    print("=========================================")

    if not GROQ_API_KEY:

        print("WARNING: Set GROQ_API_KEY in your PowerShell environment or .env file.")

    app.run(debug=True, port=5000)