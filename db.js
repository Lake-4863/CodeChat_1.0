/**
 * db.js — Node.js サーバーサイド用 SQLite セットアップ（開発・検証用）
 * フロントエンドは sql.js (WebAssembly) を使用しているため、
 * このファイルはサーバー側でのデータ確認や将来のバックエンド移行を想定している。
 */
const sqlite3 = require('sqlite3').verbose();

// データベースを開く（存在しない場合は作成）
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the SQLite database.');
});

// テーブル作成
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    user_id TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`, (err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('Users table created or already exists.');
    }
  });
});

// ユーザーを保存する関数
function saveUser(username, userId, password) {
  const stmt = db.prepare(`INSERT INTO users (username, user_id, password) VALUES (?, ?, ?)`);
  stmt.run(username, userId, password, function(err) {
    if (err) {
      console.error(err.message);
    } else {
      console.log(`User saved with ID: ${this.lastID}`);
    }
  });
  stmt.finalize();
}

// サンプルデータの挿入
saveUser('John Doe', 'john123', 'password123');
saveUser('Jane Smith', 'jane456', 'password456');

// データベースを閉じる
db.close((err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Database connection closed.');
});