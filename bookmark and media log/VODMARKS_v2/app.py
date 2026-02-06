
import os
import sqlite3
from datetime import datetime, timezone
from flask import Flask, jsonify, request, render_template, send_file
from werkzeug.utils import secure_filename
import yt_dlp

APP_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(APP_DIR, "vodmarks.db")
UPLOAD_FOLDER = os.path.join(APP_DIR, "srt_uploads")
ALLOWED_EXTENSIONS = {'srt'}

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max file size

# Ensure upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = db()
    cur = conn.cursor()
    cur.execute("""CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        created_at TEXT NOT NULL
    );""")
    cur.execute("""CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL,
        url TEXT,
        title TEXT,
        uploader TEXT,
        upload_date TEXT,
        duration_seconds INTEGER,
        thumbnail_url TEXT,
        srt_file_path TEXT,
        entry_type TEXT DEFAULT 'youtube',
        created_at TEXT NOT NULL
    );""")
    
    # Auto-migrate: Check if we need to fix the schema
    cur.execute("PRAGMA table_info(bookmarks)")
    columns = {row[1]: row for row in cur.fetchall()}
    
    needs_migration = False
    
    # Check if entry_type column exists
    if 'entry_type' not in columns:
        needs_migration = True
    
    # Check if url column has NOT NULL constraint (notnull is index 3 in pragma result)
    if 'url' in columns and columns['url'][3] == 1:  # 1 means NOT NULL
        needs_migration = True
    
    if needs_migration:
        print("Migrating database schema...")
        # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
        cur.execute("""CREATE TABLE IF NOT EXISTS bookmarks_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL,
            url TEXT,
            title TEXT,
            uploader TEXT,
            upload_date TEXT,
            duration_seconds INTEGER,
            thumbnail_url TEXT,
            srt_file_path TEXT,
            entry_type TEXT DEFAULT 'youtube',
            created_at TEXT NOT NULL
        );""")
        
        # Get existing columns to copy
        cur.execute("PRAGMA table_info(bookmarks)")
        old_columns = [row[1] for row in cur.fetchall()]
        
        # Build the column list for copying (only columns that exist in both)
        new_cols = ['id', 'folder_id', 'url', 'title', 'uploader', 'upload_date', 
                    'duration_seconds', 'thumbnail_url', 'srt_file_path', 'entry_type', 'created_at']
        copy_cols = [c for c in new_cols if c in old_columns]
        
        # Copy data
        cols_str = ', '.join(copy_cols)
        cur.execute(f"INSERT INTO bookmarks_new ({cols_str}) SELECT {cols_str} FROM bookmarks")
        
        # Swap tables
        cur.execute("DROP TABLE bookmarks")
        cur.execute("ALTER TABLE bookmarks_new RENAME TO bookmarks")
        print("Migration complete!")
    
    # Media Log table
    cur.execute("""CREATE TABLE IF NOT EXISTS media_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        progress TEXT DEFAULT '',
        status TEXT DEFAULT 'plan_to_start',
        created_at TEXT NOT NULL
    );""")

    cur.execute("SELECT id FROM folders WHERE parent_id IS NULL AND name='Root'")
    if not cur.fetchone():
        cur.execute("INSERT INTO folders VALUES (NULL,'Root',NULL,?)",
                    (datetime.now(timezone.utc).isoformat(),))
    conn.commit()
    conn.close()

def get_tree():
    conn = db()
    folders = conn.execute("SELECT id, name, parent_id FROM folders").fetchall()
    direct_counts = conn.execute("SELECT folder_id, COUNT(*) AS c FROM bookmarks GROUP BY folder_id").fetchall()
    conn.close()

    direct = {row["folder_id"]: row["c"] for row in direct_counts}
    by_parent = {}
    for f in folders:
        d = dict(f)
        d["children"] = []
        d["count"] = 0
        by_parent.setdefault(d["parent_id"], []).append(d)

    def build(pid):
        kids = by_parent.get(pid, [])
        for k in kids:
            k["children"] = build(k["id"])
            k["count"] = int(direct.get(k["id"], 0)) + sum(ch.get("count", 0) for ch in k["children"])
        return kids

    return build(None)

def get_root():
    conn = db()
    r = conn.execute("SELECT id FROM folders WHERE parent_id IS NULL").fetchone()
    conn.close()
    return r["id"]

def yt_meta(url):
    ydl_opts = {"quiet": True, "skip_download": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info.get("entries"):
        info = info["entries"][0]
    d = info.get("upload_date")
    if d and len(d)==8:
        d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
    return {
        "title": info.get("title"),
        "uploader": info.get("uploader"),
        "thumbnail_url": info.get("thumbnail"),
        "duration_seconds": info.get("duration"),
        "upload_date": d,
    }

def get_all_descendant_folder_ids(folder_id):
    conn = db()
    rows = conn.execute("SELECT id,parent_id FROM folders").fetchall()
    conn.close()
    children = {}
    for r in rows:
        children.setdefault(r["parent_id"], []).append(r["id"])
    out = []
    stack = [folder_id]
    while stack:
        fid = stack.pop()
        out.append(fid)
        stack.extend(children.get(fid, []))
    return out

def get_folder_breadcrumb(folder_id):
    """Get breadcrumb path for a folder like 'Root > Gaming > Clips'"""
    conn = db()
    folders = {r["id"]: r for r in conn.execute("SELECT id, name, parent_id FROM folders").fetchall()}
    conn.close()
    parts = []
    fid = folder_id
    while fid and fid in folders:
        parts.append(folders[fid]["name"])
        fid = folders[fid]["parent_id"]
    parts.reverse()
    return " > ".join(parts)

# PROPER merged: only duplicates, one row per name
def merged_groups(min_dupes=2):
    conn = db()
    rows = conn.execute("SELECT id, name FROM folders WHERE parent_id IS NOT NULL").fetchall()
    buckets = {}
    for r in rows:
        key = r["name"].strip().lower()
        buckets.setdefault(key, []).append(r["id"])
    out = []
    for key, ids in buckets.items():
        if len(ids) < min_dupes:
            continue
        q = "SELECT COUNT(*) as c FROM bookmarks WHERE folder_id IN (%s)" % ",".join(["?"]*len(ids))
        c = conn.execute(q, ids).fetchone()["c"]
        out.append({"key": key, "name": key, "ids": ids, "total": int(c)})
    conn.close()
    return out

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/tree")
def tree():
    return jsonify({"tree": get_tree(), "root": get_root(), "merged": merged_groups()})

@app.get("/api/merged")
def api_merged():
    groups = merged_groups()
    return jsonify({"groups": [
        {"key": g["key"], "name": g["name"].title(), "total_bookmarks": g["total"]}
        for g in groups
    ]})

@app.get("/api/merged_bookmarks")
def api_merged_bookmarks():
    key = (request.args.get("key") or "").strip().lower()
    groups = merged_groups()
    match = next((g for g in groups if g["key"] == key), None)
    if not match:
        return jsonify([])
    ids = match["ids"]
    conn = db()
    q = ("SELECT b.*, f.name AS folder_name FROM bookmarks b "
         "LEFT JOIN folders f ON b.folder_id = f.id "
         "WHERE b.folder_id IN (%s) ORDER BY b.upload_date ASC") % ",".join(["?"]*len(ids))
    rows = conn.execute(q, ids).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        # Build breadcrumb for this bookmark's folder
        d["folder_breadcrumb"] = get_folder_breadcrumb(d["folder_id"])
        results.append(d)
    return jsonify(results)

@app.get("/api/bookmarks")
def bookmarks():
    fid = int(request.args.get("folder_id"))
    all_ids = get_all_descendant_folder_ids(fid)
    conn = db()
    q = "SELECT * FROM bookmarks WHERE folder_id IN (%s) ORDER BY entry_type, upload_date ASC" % ",".join(["?"]*len(all_ids))
    rows = conn.execute(q, all_ids).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.post("/api/folder")
def add_folder():
    data = request.json
    name = data.get("name")
    parent = data.get("parent_id")
    conn = db()
    conn.execute("INSERT INTO folders VALUES (NULL,?,?,?)", (name, parent, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    return jsonify(ok=True)

@app.post("/api/bookmark")
def add_bookmark():
    data = request.json
    fid = data.get("folder_id")
    url = data.get("url")
    
    # Check if it's a simple media entry (no URL)
    entry_type = data.get("entry_type", "youtube")
    
    if entry_type == "media":
        # Simple media entry - just title and date
        title = data.get("title")
        date = data.get("date")
        conn = db()
        conn.execute("""INSERT INTO bookmarks 
            (folder_id, url, title, uploader, upload_date, duration_seconds, thumbnail_url, srt_file_path, entry_type, created_at) 
            VALUES (?,?,?,?,?,?,?,?,?,?)""", (
            fid, None, title, None, date, None, None, None, "media", datetime.now(timezone.utc).isoformat()
        ))
        conn.commit()
        conn.close()
        return jsonify(ok=True)
    else:
        # YouTube entry
        meta = yt_meta(url)
        conn = db()
        conn.execute("""INSERT INTO bookmarks 
            (folder_id, url, title, uploader, upload_date, duration_seconds, thumbnail_url, srt_file_path, entry_type, created_at) 
            VALUES (?,?,?,?,?,?,?,?,?,?)""", (
            fid, url,
            meta.get("title"),
            meta.get("uploader"),
            meta.get("upload_date"),
            meta.get("duration_seconds"),
            meta.get("thumbnail_url"),
            None,  # srt_file_path
            "youtube",
            datetime.now(timezone.utc).isoformat()
        ))
        conn.commit()
        conn.close()
        return jsonify(ok=True)


@app.patch("/api/folder/<int:fid>")
def rename_folder(fid):
    data = request.json or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="Name is required."), 400
    if fid == get_root():
        return jsonify(error="Can't rename Root."), 400
    conn = db()
    cur = conn.execute("UPDATE folders SET name=? WHERE id=?", (name, fid))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify(error="Folder not found."), 404
    return jsonify(ok=True)

@app.delete("/api/folder/<int:fid>")
def delete_folder(fid):
    root_id = get_root()
    if fid == root_id:
        return jsonify(error="Can't delete Root."), 400

    # Ensure folder exists
    conn = db()
    exists = conn.execute("SELECT id FROM folders WHERE id=?", (fid,)).fetchone()
    if not exists:
        conn.close()
        return jsonify(error="Folder not found."), 404

    ids = get_all_descendant_folder_ids(fid)

    # Delete bookmarks in this subtree
    q1 = "DELETE FROM bookmarks WHERE folder_id IN (%s)" % ",".join(["?"] * len(ids))
    conn.execute(q1, ids)

    # Delete folders in this subtree (children included)
    q2 = "DELETE FROM folders WHERE id IN (%s)" % ",".join(["?"] * len(ids))
    conn.execute(q2, ids)

    conn.commit()
    conn.close()
    return jsonify(ok=True, deleted_folders=len(ids))

@app.patch("/api/bookmark/<int:bid>")
def update_bookmark(bid):
    data = request.json or {}
    conn = db()
    bookmark = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not bookmark:
        conn.close()
        return jsonify(error="Bookmark not found."), 404
    folder_id = data.get("folder_id")
    if folder_id is not None:
        folder = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
        if not folder:
            conn.close()
            return jsonify(error="Target folder not found."), 404
        conn.execute("UPDATE bookmarks SET folder_id=? WHERE id=?", (folder_id, bid))
    conn.commit()
    conn.close()
    return jsonify(ok=True)

@app.post("/api/bookmarks/bulk_delete")
def bulk_delete_bookmarks():
    data = request.json or {}
    ids = data.get("ids", [])
    if not ids:
        return jsonify(error="No bookmark IDs provided."), 400
    conn = db()
    q = "DELETE FROM bookmarks WHERE id IN (%s)" % ",".join(["?"] * len(ids))
    cur = conn.execute(q, ids)
    conn.commit()
    conn.close()
    return jsonify(ok=True, deleted=cur.rowcount)

@app.post("/api/bookmarks/bulk_move")
def bulk_move_bookmarks():
    data = request.json or {}
    ids = data.get("ids", [])
    folder_id = data.get("folder_id")
    if not ids or not folder_id:
        return jsonify(error="IDs and folder_id required."), 400
    conn = db()
    folder = conn.execute("SELECT id FROM folders WHERE id=?", (folder_id,)).fetchone()
    if not folder:
        conn.close()
        return jsonify(error="Target folder not found."), 404
    q = "UPDATE bookmarks SET folder_id=? WHERE id IN (%s)" % ",".join(["?"] * len(ids))
    conn.execute(q, [folder_id] + ids)
    conn.commit()
    conn.close()
    return jsonify(ok=True)

@app.get("/api/folders_flat")
def folders_flat():
    """Return flat list of all folders with breadcrumbs for move-to picker."""
    conn = db()
    rows = conn.execute("SELECT id, name, parent_id FROM folders").fetchall()
    conn.close()
    folders_map = {r["id"]: dict(r) for r in rows}
    result = []
    for fid, f in folders_map.items():
        parts = []
        cur = fid
        while cur and cur in folders_map:
            parts.append(folders_map[cur]["name"])
            cur = folders_map[cur]["parent_id"]
        parts.reverse()
        result.append({"id": fid, "name": f["name"], "breadcrumb": " > ".join(parts)})
    return jsonify(result)

@app.delete("/api/bookmark/<int:bid>")
def delete_bookmark(bid):
    conn = db()
    cur = conn.execute("DELETE FROM bookmarks WHERE id=?", (bid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify(error="Bookmark not found."), 404
    return jsonify(ok=True)

@app.post("/api/bookmark/<int:bid>/upload_srt")
def upload_srt(bid):
    # Check if bookmark exists
    conn = db()
    bookmark = conn.execute("SELECT id FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if not bookmark:
        conn.close()
        return jsonify(error="Bookmark not found."), 404
    
    # Check if file was uploaded
    if 'srt_file' not in request.files:
        conn.close()
        return jsonify(error="No file uploaded."), 400
    
    file = request.files['srt_file']
    
    # Check if filename is empty
    if file.filename == '':
        conn.close()
        return jsonify(error="No file selected."), 400
    
    # Check if file type is allowed
    if not allowed_file(file.filename):
        conn.close()
        return jsonify(error="Only .srt files are allowed."), 400
    
    # Save the file with a unique name
    filename = secure_filename(file.filename)
    unique_filename = f"bookmark_{bid}_{filename}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    
    # Delete old SRT if exists
    old_srt = conn.execute("SELECT srt_file_path FROM bookmarks WHERE id=?", (bid,)).fetchone()
    if old_srt and old_srt['srt_file_path']:
        old_path = os.path.join(APP_DIR, old_srt['srt_file_path'])
        if os.path.exists(old_path):
            os.remove(old_path)
    
    file.save(filepath)
    
    # Update database with relative path
    relative_path = os.path.join("srt_uploads", unique_filename)
    conn.execute("UPDATE bookmarks SET srt_file_path=? WHERE id=?", (relative_path, bid))
    conn.commit()
    conn.close()
    
    return jsonify(ok=True, srt_file_path=relative_path)

@app.delete("/api/bookmark/<int:bid>/srt")
def delete_srt(bid):
    conn = db()
    bookmark = conn.execute("SELECT srt_file_path FROM bookmarks WHERE id=?", (bid,)).fetchone()
    
    if not bookmark:
        conn.close()
        return jsonify(error="Bookmark not found."), 404
    
    if bookmark['srt_file_path']:
        filepath = os.path.join(APP_DIR, bookmark['srt_file_path'])
        if os.path.exists(filepath):
            os.remove(filepath)
    
    conn.execute("UPDATE bookmarks SET srt_file_path=NULL WHERE id=?", (bid,))
    conn.commit()
    conn.close()
    
    return jsonify(ok=True)

@app.get("/api/bookmark/<int:bid>/srt")
def get_srt(bid):
    conn = db()
    bookmark = conn.execute("SELECT srt_file_path, title FROM bookmarks WHERE id=?", (bid,)).fetchone()
    conn.close()
    
    if not bookmark:
        return jsonify(error="Bookmark not found."), 404
    
    if not bookmark['srt_file_path']:
        return jsonify(error="No SRT file uploaded."), 404
    
    filepath = os.path.join(APP_DIR, bookmark['srt_file_path'])
    
    if not os.path.exists(filepath):
        return jsonify(error="SRT file not found."), 404
    
    # Use the bookmark title for the download filename
    title = bookmark['title'] or f"bookmark_{bid}"
    # Sanitize title for filename
    safe_title = "".join(c for c in title if c.isalnum() or c in (' ', '-', '_')).strip()
    download_name = f"{safe_title}.srt"
    
    return send_file(filepath, as_attachment=True, download_name=download_name)

## ── Media Log API ──

MEDIA_LOG_CATEGORIES = {"anime", "movies", "tv", "manga", "books", "games"}
MEDIA_LOG_STATUSES = {"currently", "completed", "plan_to_start"}

@app.get("/api/media_log")
def get_media_log():
    category = (request.args.get("category") or "").strip().lower()
    conn = db()
    if category and category in MEDIA_LOG_CATEGORIES:
        rows = conn.execute("SELECT * FROM media_log WHERE category=? ORDER BY status, title ASC", (category,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM media_log ORDER BY category, status, title ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.post("/api/media_log")
def add_media_log():
    data = request.json or {}
    category = (data.get("category") or "").strip().lower()
    title = (data.get("title") or "").strip()
    progress = (data.get("progress") or "").strip()
    status = (data.get("status") or "plan_to_start").strip()
    if category not in MEDIA_LOG_CATEGORIES:
        return jsonify(error="Invalid category."), 400
    if not title:
        return jsonify(error="Title is required."), 400
    if status not in MEDIA_LOG_STATUSES:
        return jsonify(error="Invalid status."), 400
    conn = db()
    conn.execute("INSERT INTO media_log (category, title, progress, status, created_at) VALUES (?,?,?,?,?)",
                 (category, title, progress, status, datetime.now(timezone.utc).isoformat()))
    conn.commit()
    conn.close()
    return jsonify(ok=True)

@app.patch("/api/media_log/<int:mid>")
def update_media_log(mid):
    data = request.json or {}
    conn = db()
    row = conn.execute("SELECT * FROM media_log WHERE id=?", (mid,)).fetchone()
    if not row:
        conn.close()
        return jsonify(error="Entry not found."), 404
    title = (data.get("title") or "").strip() or row["title"]
    progress = data.get("progress") if "progress" in data else row["progress"]
    status = (data.get("status") or "").strip() or row["status"]
    if status not in MEDIA_LOG_STATUSES:
        conn.close()
        return jsonify(error="Invalid status."), 400
    conn.execute("UPDATE media_log SET title=?, progress=?, status=? WHERE id=?",
                 (title, progress, status, mid))
    conn.commit()
    conn.close()
    return jsonify(ok=True)

@app.delete("/api/media_log/<int:mid>")
def delete_media_log(mid):
    conn = db()
    cur = conn.execute("DELETE FROM media_log WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify(error="Entry not found."), 404
    return jsonify(ok=True)

if __name__ == "__main__":
    init_db()
    app.run(port=5177, debug=True)
