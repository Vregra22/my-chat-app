from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import json
import uuid
from typing import Dict, List
from datetime import datetime
import uvicorn
import io
import os
from PIL import Image
import hashlib
import sqlite3
from contextlib import contextmanager

app = FastAPI(title="Corporate Chat System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Loyihaning asosiy mutloq manzilini aniqlash (Render uchun eng muhimi)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# STATIC FAYLLAR (Mutloq manzil orqali ulash)
assets_path = os.path.join(BASE_DIR, "assets")
if not os.path.exists(assets_path):
    os.makedirs(assets_path, exist_ok=True)
app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

# ROOT
@app.get("/")
async def root():
    html_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    return HTMLResponse("<h3>index.html fayli topilmadi!</h3>", status_code=404)

# ==================== DATABASE ====================

DB_PATH = os.path.join(BASE_DIR, "database.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                role TEXT DEFAULT 'user',
                avatar TEXT,
                face_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                sender TEXT,
                content TEXT,
                msg_type TEXT DEFAULT 'text',
                media TEXT,
                timestamp TIMESTAMP,
                view_count INTEGER DEFAULT 0
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS message_views (
                message_id TEXT,
                username TEXT,
                viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (message_id, username)
            )
        ''')
        cursor.execute('''
            INSERT OR IGNORE INTO users (username, role, avatar)
            VALUES ('admin', 'admin', '/assets/icons/admin_lock.png')
        ''')
        conn.commit()
        print("✅ Database initialized!")

init_db()

@contextmanager
def db_connection():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def save_user(username, role="user", avatar=None, face_hash=None):
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT OR REPLACE INTO users (username, role, avatar, face_hash)
            VALUES (?, ?, ?, ?)
        ''', (username, role, avatar or '/assets/icons/user_default.png', face_hash))

def get_user(username):
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_all_users():
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT username, role, avatar FROM users')
        return [dict(row) for row in cursor.fetchall()]

def save_message(msg_id, sender, content, msg_type="text", media=None):
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO messages (id, sender, content, msg_type, media, timestamp, view_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (msg_id, sender, content, msg_type, media, datetime.now().isoformat(), 0))

def get_messages(limit=50):
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, sender, content, msg_type, media, timestamp, view_count
            FROM messages
            ORDER BY timestamp DESC
            LIMIT ?
        ''', (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in reversed(rows)]

def add_view(message_id, username):
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT 1 FROM message_views WHERE message_id = ? AND username = ?
        ''', (message_id, username))
        if not cursor.fetchone():
            cursor.execute('''
                INSERT INTO message_views (message_id, username)
                VALUES (?, ?)
            ''', (message_id, username))
            cursor.execute('''
                UPDATE messages 
                SET view_count = (SELECT COUNT(*) FROM message_views WHERE message_id = ?)
                WHERE id = ?
            ''', (message_id, message_id))
            cursor.execute('SELECT view_count FROM messages WHERE id = ?', (message_id,))
            row = cursor.fetchone()
            return row[0] if row else 0
        cursor.execute('SELECT view_count FROM messages WHERE id = ?', (message_id,))
        row = cursor.fetchone()
        return row[0] if row else 0

def get_registered_users():
    with db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT username FROM users WHERE role = "user"')
        return [row[0] for row in cursor.fetchall()]

# In-memory
users: Dict[str, any] = {}
for user_data in get_all_users():
    class User:
        def __init__(self, data):
            self.username = data["username"]
            self.role = data["role"]
            self.avatar = data.get("avatar", "/assets/icons/user_default.png")
            self.is_online = False
            self.websocket = None
    users[user_data["username"]] = User(user_data)

messages_cache = []
messages_cache.extend(get_messages(100))
active_connections = {}

# ==================== FACE RECOGNITION ====================

def get_face_hash(image_data: bytes) -> str:
    try:
        img = Image.open(io.BytesIO(image_data))
        img = img.resize((100, 100))
        img = img.convert('L')
        pixels = list(img.getdata())
        return hashlib.md5(str(pixels[:500]).encode()).hexdigest()
    except:
        return None

# ==================== WEBSOCKET MANAGER ====================

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
    
    async def connect(self, websocket: WebSocket, username: str):
        await websocket.accept()
        self.active_connections[username] = websocket
        if username in users:
            users[username].is_online = True
            users[username].websocket = websocket
        print(f"✅ {username} connected")
        await self.broadcast({
            "type": "user_status",
            "username": username,
            "status": "online"
        })
    
    def disconnect(self, username: str):
        if username in self.active_connections:
            del self.active_connections[username]
            if username in users:
                users[username].is_online = False
                users[username].websocket = None
        print(f"❌ {username} disconnected")
    
    async def broadcast(self, message: dict, exclude: str = None):
        for username, connection in self.active_connections.items():
            if username != exclude:
                try:
                    await connection.send_json(message)
                except:
                    pass

manager = ConnectionManager()

# ==================== API ENDPOINTLAR ====================

@app.post("/api/login")
async def login(
    username: str = Form(...),
    password: str = Form(None),
    face_image: UploadFile = File(None)
):
    if username == "admin":
        if password == "2010":
            save_user(username, "admin", "/assets/icons/admin_lock.png")
            if username not in users:
                class User:
                    def __init__(self, data):
                        self.username = data["username"]
                        self.role = data["role"]
                        self.avatar = data.get("avatar", "/assets/icons/admin_lock.png")
                        self.is_online = False
                        self.websocket = None
                users[username] = User({"username": username, "role": "admin", "avatar": "/assets/icons/admin_lock.png"})
            return {
                "success": True,
                "role": "admin",
                "username": username,
                "avatar": "/assets/icons/admin_lock.png"
            }
        else:
            raise HTTPException(status_code=401, detail="Parol xato!")
    
    if face_image:
        image_data = await face_image.read()
        user_data = get_user(username)
        if not user_data:
            raise HTTPException(status_code=401, detail=f"'{username}' ro'yxatdan o'tmagan!")
        current_hash = get_face_hash(image_data)
        stored_hash = user_data.get("face_hash")
        if current_hash and current_hash == stored_hash:
            if username not in users:
                class User:
                    def __init__(self, data):
                        self.username = data["username"]
                        self.role = data["role"]
                        self.avatar = data.get("avatar", "/assets/icons/user_default.png")
                        self.is_online = False
                        self.websocket = None
                users[username] = User(user_data)
            return {
                "success": True,
                "role": "user",
                "username": username,
                "avatar": user_data.get("avatar", "/assets/icons/user_default.png")
            }
        else:
            raise HTTPException(status_code=401, detail="Yuz mos kelmadi!")
    
    raise HTTPException(status_code=401, detail="Noto'g'ri ma'lumotlar!")

@app.post("/api/admin/register-face")
async def register_face(
    username: str = Form(...),
    face_image: UploadFile = File(...)
):
    image_data = await face_image.read()
    face_hash = get_face_hash(image_data)
    if not face_hash:
        raise HTTPException(status_code=400, detail="Rasm o'qib bo'lmadi!")
    save_user(username, "user", "/assets/icons/user_default.png", face_hash)
    if username not in users:
        class User:
            def __init__(self, data):
                self.username = data["username"]
                self.role = data["role"]
                self.avatar = data.get("avatar", "/assets/icons/user_default.png")
                self.is_online = False
                self.websocket = None
        users[username] = User({"username": username, "role": "user", "avatar": "/assets/icons/user_default.png"})
    return {
        "success": True,
        "message": f"{username} ro'yxatdan o'tkazildi!",
        "total_users": len(get_registered_users())
    }

@app.get("/api/messages")
async def get_messages_api(limit: int = 50):
    return {"messages": get_messages(limit)}

@app.get("/api/users/online")
async def get_online_users():
    online = [username for username, user in users.items() if user.is_online]
    return {"online_users": online}

@app.get("/api/users/registered")
async def get_registered_users_api():
    return {"registered_users": get_registered_users()}

# ==================== WEBSOCKET ====================

@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    if username not in users:
        await websocket.close(code=1008)
        return
    await manager.connect(websocket, username)
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            if message_data.get("type") == "chat_message":
                content = message_data.get("content", "")
                msg_id = str(uuid.uuid4())[:8]
                save_message(msg_id, username, content, "text")
                msg_data = {
                    "id": msg_id,
                    "sender": username,
                    "content": content,
                    "type": "text",
                    "media": None,
                    "timestamp": datetime.now().isoformat(),
                    "view_count": 0
                }
                messages_cache.append(msg_data)
                await manager.broadcast({"type": "new_message", "message": msg_data})
            elif message_data.get("type") == "media_message":
                content = message_data.get("content", "")
                media_type = message_data.get("media_type", "image")
                media_data = message_data.get("media_data", "")
                msg_id = str(uuid.uuid4())[:8]
                save_message(msg_id, username, content, media_type, media_data)
                msg_data = {
                    "id": msg_id,
                    "sender": username,
                    "content": content,
                    "type": media_type,
                    "media": media_data,
                    "timestamp": datetime.now().isoformat(),
                    "view_count": 0
                }
                messages_cache.append(msg_data)
                await manager.broadcast({"type": "new_message", "message": msg_data})
            elif message_data.get("type") == "view_action":
                msg_id = message_data.get("msg_id")
                view_count = add_view(msg_id, username)
                for msg in messages_cache:
                    if msg["id"] == msg_id:
                        msg["view_count"] = view_count
                        break
                await manager.broadcast({
                    "type": "update_views",
                    "msg_id": msg_id,
                    "view_count": view_count
                })
    except WebSocketDisconnect:
        manager.disconnect(username)
        await manager.broadcast({
            "type": "user_status",
            "username": username,
            "status": "offline"
        })

# ==================== ISHGA TUSHIRISH ====================

if __name__ == "__main__":
    print("=" * 60)
    print("🎯 KORPORATIV CHAT SERVER")
    print("=" * 60)
    print(f"📍 http://127.0.0.1:8000")
    print(f"🔑 Admin: admin / 2010")
    print(f"🌙 Dark/Light mode")
    print(f"😊 Emoji panel")
    print(f"📊 Upload progress")
    print("=" * 60)
    # Render muhitidagi dinamik portni olish tizimi
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)