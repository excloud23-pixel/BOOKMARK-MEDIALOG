import sqlite3
import os

# Update your existing database to support both YouTube and media entries
DB_PATH = os.path.join(os.path.dirname(__file__), "vodmarks.db")

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    
    # Check if entry_type column exists
    cur.execute("PRAGMA table_info(bookmarks)")
    columns = [row[1] for row in cur.fetchall()]
    
    if 'entry_type' not in columns:
        print("Adding entry_type column...")
        cur.execute("ALTER TABLE bookmarks ADD COLUMN entry_type TEXT DEFAULT 'youtube'")
        conn.commit()
        print("✓ Added entry_type column")
    else:
        print("✓ entry_type column already exists")
    
    # Make url column nullable if needed (SQLite doesn't support ALTER COLUMN, so we'll just note it)
    print("\nNote: URL column constraint remains. New media entries will have NULL urls.")
    print("Migration complete! You can now add both YouTube VODs and simple media entries.")
    
    conn.close()

if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        print("No database found. Run app.py first to create a new database.")
    else:
        migrate()
