const crypto = require('crypto');
const path = require('path');
const fs = require('fs-extra');
const { decryptSecret, encryptSecret } = require('./security');
const { generateEnvironment } = require('./environment');
const { getProfilesDir } = require('./paths');

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return Date.now();
}

function parseEnvironment(row) {
  return {
    ...row,
    environment: JSON.parse(row.environment_json),
    environment_json: undefined
  };
}

function parseProxy(row, includePassword = false) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username || '',
    password: includePassword ? decryptSecret(row.encrypted_password) : '',
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

class AccountRepository {
  constructor(db) {
    this.db = db;
  }

  async list() {
    const rows = await this.db.all(`
      SELECT accounts.*, proxies.name AS proxy_name
      FROM accounts
      LEFT JOIN proxies ON accounts.proxy_id = proxies.id
      ORDER BY COALESCE(accounts.last_opened_at, accounts.created_at) DESC
    `);
    return rows.map((row) => ({
      ...parseEnvironment(row),
      proxy_name: row.proxy_name || '',
      last_url: row.last_url || null
    }));
  }

  async get(id) {
    const row = await this.db.get('SELECT * FROM accounts WHERE id = ?', [id]);
    return row ? {
      ...parseEnvironment(row),
      last_url: row.last_url || null
    } : null;
  }

  async create(input) {
    const id = createId('acct');
    const timestamp = now();
    const profilePath = path.join(getProfilesDir(), id);
    const baseEnvironment = input.environment || generateEnvironment(id);
    const environment = {
      ...baseEnvironment,
      homepage: input.homepage || baseEnvironment.homepage || 'https://www.dola.com/chat/create-image'
    };

    await fs.ensureDir(profilePath);
    await this.db.run(
      `
      INSERT INTO accounts
        (id, name, remark, profile_path, environment_json, proxy_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(input.name || '').trim(),
        String(input.remark || '').trim(),
        profilePath,
        JSON.stringify(environment),
        input.proxy_id || null,
        timestamp,
        timestamp
      ]
    );

    return this.get(id);
  }

  async update(id, input) {
    const existing = await this.get(id);
    if (!existing) throw new Error('Account not found');

    const updated = {
      name: input.name === undefined ? existing.name : String(input.name).trim(),
      remark: input.remark === undefined ? existing.remark || '' : String(input.remark || '').trim(),
      environment: {
        ...existing.environment,
        ...(input.environment || {}),
        homepage: input.homepage !== undefined ? input.homepage : (existing.environment.homepage || 'https://www.dola.com/chat/create-image')
      },
      proxy_id: input.proxy_id === undefined ? existing.proxy_id : input.proxy_id || null
    };

    await this.db.run(
      `
      UPDATE accounts
      SET name = ?, remark = ?, environment_json = ?, proxy_id = ?, updated_at = ?
      WHERE id = ?
      `,
      [
        updated.name,
        updated.remark,
        JSON.stringify(updated.environment),
        updated.proxy_id,
        now(),
        id
      ]
    );

    return this.get(id);
  }

  async markOpened(id) {
    await this.db.run('UPDATE accounts SET last_opened_at = ? WHERE id = ?', [now(), id]);
  }

  async saveLastUrl(id, url) {
    await this.db.run('UPDATE accounts SET last_url = ? WHERE id = ?', [url, id]);
  }

  async delete(id) {
    const account = await this.get(id);
    if (!account) return false;
    await this.db.run('DELETE FROM accounts WHERE id = ?', [id]);
    await fs.remove(account.profile_path);
    return true;
  }
}

class ProxyRepository {
  constructor(db) {
    this.db = db;
  }

  async list() {
    const rows = await this.db.all('SELECT * FROM proxies ORDER BY updated_at DESC');
    return rows.map((row) => parseProxy(row));
  }

  async get(id, includePassword = false) {
    const row = await this.db.get('SELECT * FROM proxies WHERE id = ?', [id]);
    return parseProxy(row, includePassword);
  }

  async create(input) {
    const id = createId('proxy');
    const timestamp = now();

    await this.db.run(
      `
      INSERT INTO proxies
        (id, name, protocol, host, port, username, encrypted_password, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(input.name || '').trim(),
        input.protocol,
        String(input.host || '').trim(),
        Number(input.port),
        String(input.username || '').trim(),
        encryptSecret(input.password || ''),
        input.enabled === false ? 0 : 1,
        timestamp,
        timestamp
      ]
    );

    return this.get(id);
  }

  async update(id, input) {
    const existing = await this.get(id, true);
    if (!existing) throw new Error('Proxy not found');
    const password =
      input.password === undefined || input.password === ''
        ? existing.password || ''
        : input.password;

    await this.db.run(
      `
      UPDATE proxies
      SET name = ?, protocol = ?, host = ?, port = ?, username = ?,
          encrypted_password = ?, enabled = ?, updated_at = ?
      WHERE id = ?
      `,
      [
        input.name === undefined ? existing.name : String(input.name).trim(),
        input.protocol || existing.protocol,
        input.host === undefined ? existing.host : String(input.host).trim(),
        input.port === undefined ? existing.port : Number(input.port),
        input.username === undefined ? existing.username : String(input.username || '').trim(),
        encryptSecret(password),
        input.enabled === undefined ? Number(existing.enabled) : input.enabled ? 1 : 0,
        now(),
        id
      ]
    );

    return this.get(id);
  }

  async delete(id) {
    await this.db.run('UPDATE accounts SET proxy_id = NULL WHERE proxy_id = ?', [id]);
    const result = await this.db.run('DELETE FROM proxies WHERE id = ?', [id]);
    return result.changes > 0;
  }
}

function parseExtension(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class ExtensionRepository {
  constructor(db) {
    this.db = db;
  }

  async list() {
    const rows = await this.db.all('SELECT * FROM extensions ORDER BY updated_at DESC');
    return rows.map((row) => parseExtension(row));
  }

  async get(id) {
    const row = await this.db.get('SELECT * FROM extensions WHERE id = ?', [id]);
    return parseExtension(row);
  }

  async create(input) {
    const id = createId('ext');
    const timestamp = now();

    await this.db.run(
      `
      INSERT INTO extensions
        (id, name, path, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        String(input.name || '').trim(),
        String(input.path || '').trim(),
        input.enabled === false ? 0 : 1,
        timestamp,
        timestamp
      ]
    );

    return this.get(id);
  }

  async update(id, input) {
    const existing = await this.get(id);
    if (!existing) throw new Error('Extension not found');

    await this.db.run(
      `
      UPDATE extensions
      SET name = ?, path = ?, enabled = ?, updated_at = ?
      WHERE id = ?
      `,
      [
        input.name === undefined ? existing.name : String(input.name).trim(),
        input.path === undefined ? existing.path : String(input.path).trim(),
        input.enabled === undefined ? Number(existing.enabled) : input.enabled ? 1 : 0,
        now(),
        id
      ]
    );

    return this.get(id);
  }

  async delete(id) {
    const result = await this.db.run('DELETE FROM extensions WHERE id = ?', [id]);
    return result.changes > 0;
  }
}

class DownloadHistoryRepository {
  constructor(db) {
    this.db = db;
  }

  async getByAccount(accountId) {
    const rows = await this.db.all(
      'SELECT * FROM download_history WHERE account_id = ? ORDER BY created_at DESC',
      [accountId]
    );
    return rows;
  }

  async getByVideoId(accountId, videoId) {
    const row = await this.db.get(
      'SELECT * FROM download_history WHERE account_id = ? AND video_id = ?',
      [accountId, videoId]
    );
    return row;
  }

  async create(input) {
    const id = createId('dl');
    const timestamp = now();
    try {
      await this.db.run(
        `
        INSERT INTO download_history
          (id, account_id, video_id, video_url, filename, file_path, width, height, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          input.account_id,
          input.video_id,
          input.video_url,
          input.filename,
          input.file_path,
          input.width || null,
          input.height || null,
          input.status || 'pending',
          timestamp
        ]
      );
      return this.get(id);
    } catch (e) {
      // 如果因为 UNIQUE 约束失败，说明已经下载过了
      if (e.message && e.message.includes('UNIQUE')) {
        return await this.getByVideoId(input.account_id, input.video_id);
      }
      throw e;
    }
  }

  async get(id) {
    const row = await this.db.get('SELECT * FROM download_history WHERE id = ?', [id]);
    return row;
  }

  async updateStatus(id, status, filePath = null) {
    const updates = ['status = ?, updated_at = ?'];
    const params = [status, now()];
    
    if (filePath) {
      updates.push('file_path = ?');
      params.push(filePath);
    }
    
    if (status === 'completed') {
      updates.push('completed_at = ?');
      params.push(now());
    }
    
    params.push(id);
    
    await this.db.run(
      `UPDATE download_history SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return this.get(id);
  }

  async delete(id) {
    const result = await this.db.run('DELETE FROM download_history WHERE id = ?', [id]);
    return result.changes > 0;
  }
}

module.exports = {
  AccountRepository,
  ProxyRepository,
  ExtensionRepository,
  DownloadHistoryRepository,
  createId,
  parseProxy,
  parseExtension
};
