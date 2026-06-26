const fs = require('fs-extra');
const initSqlJs = require('sql.js');
const { getDatabasePath } = require('./paths');

class Database {
  constructor(dbPath = getDatabasePath()) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    const SQL = await initSqlJs();
    if (await fs.pathExists(this.dbPath)) {
      const fileBuffer = await fs.readFile(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    await this.run(`
      CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        encrypted_password TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        remark TEXT,
        profile_path TEXT NOT NULL,
        environment_json TEXT NOT NULL,
        proxy_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER,
        last_url TEXT,
        FOREIGN KEY(proxy_id) REFERENCES proxies(id)
      )
    `);
    
    // 为已有的数据库添加 last_url 列（如果还没有）
    try {
      await this.run('ALTER TABLE accounts ADD COLUMN last_url TEXT');
    } catch (e) {
      // 忽略错误，因为列可能已经存在
    }

    await this.run(`
      CREATE TABLE IF NOT EXISTS extensions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // 创建下载历史表
    await this.run(`
      CREATE TABLE IF NOT EXISTS download_history (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_url TEXT NOT NULL,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        UNIQUE(account_id, video_id)
      )
    `);
    
    await this.persist();
  }

  run(sql, params = []) {
    this.ensureReady();
    this.db.run(sql, params);
    return this.persist().then(() => ({ changes: this.db.getRowsModified() }));
  }

  get(sql, params = []) {
    this.ensureReady();
    const rows = this.query(sql, params);
    return Promise.resolve(rows[0] || null);
  }

  all(sql, params = []) {
    this.ensureReady();
    return Promise.resolve(this.query(sql, params));
  }

  close() {
    if (!this.db) return Promise.resolve();
    return this.persist().then(() => {
      this.db.close();
      this.db = null;
    });
  }

  query(sql, params) {
    const statement = this.db.prepare(sql, params);
    const rows = [];

    try {
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }

    return rows;
  }

  async persist() {
    this.ensureReady();
    const data = this.db.export();
    await fs.ensureDir(require('path').dirname(this.dbPath));
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  ensureReady() {
    if (!this.db) throw new Error('Database is not initialized');
  }
}

module.exports = Database;
