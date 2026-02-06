# VODMarks - YouTube VOD Bookmarker + Media Tracker

A Flask app to organize YouTube VODs and track media (anime, movies, etc.) in folders.

## Features

- **YouTube VOD Bookmarking**: Paste a YouTube URL to automatically fetch title, uploader, thumbnail, duration
- **Simple Media Tracking**: Add anime/movies/shows with just a title and year (e.g., "Frieren - 2026")
- **Folder Organization**: Create nested folders to organize both types of entries
- **SRT Subtitle Support**: Upload and download .srt files for YouTube VODs
- **Merged View**: See duplicate folder names combined

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the app:
```bash
python app.py
```

3. Open http://localhost:5177

## Migrating from Old Version

If you have an existing `vodmarks.db` from a previous version:

1. Copy your old `vodmarks.db` file into this directory
2. Copy your old `srt_uploads/` folder into this directory
3. Run the migration script:
```bash
python migrate.py
```

This will update your database to support both YouTube and media entries.

## Usage

### Adding YouTube VODs
1. Select or create a folder
2. Use the "Add YouTube VOD" section
3. Paste a YouTube URL and click "Add VOD"

### Adding Media (Anime/Movies/etc)
1. Select or create a folder (e.g., create an "Anime" or "Movies" folder)
2. Use the "Add Media" section
3. Enter title (e.g., "Frieren") and year (e.g., "2026")
4. Click "Add Media"

Media entries will display simply as: **Title - Year**

### Managing Folders
- Click folder names to view contents
- Right-click folders to rename
- Click X to delete folders (and all contents)
- Nested folders show combined counts

## File Structure

```
VODMARKS_v2/
├── app.py              # Flask backend
├── migrate.py          # Database migration script
├── requirements.txt    # Python dependencies
├── vodmarks.db        # SQLite database (created on first run)
├── srt_uploads/       # Uploaded subtitle files (created automatically)
├── templates/
│   └── index.html     # HTML template
└── static/
    ├── app.js         # Frontend JavaScript
    └── styles.css     # Styles
```

## Notes

- YouTube VODs show thumbnails and full metadata
- Media entries show as simple text: "Title - Year"
- Both types can coexist in the same folders
- All data stored in local SQLite database
