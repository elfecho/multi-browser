const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

function getProjectRoot() {
  return path.resolve(__dirname, '../..');
}

function getDataDir() {
  const devDataDir = path.join(getProjectRoot(), 'data');
  const prodDataDir = path.join(app.getPath('userData'), 'data');
  const dataDir = app.isPackaged ? prodDataDir : devDataDir;
  fs.ensureDirSync(dataDir);
  return dataDir;
}

function getProfilesDir() {
  const profilesDir = path.join(getDataDir(), 'profiles');
  fs.ensureDirSync(profilesDir);
  return profilesDir;
}

function getDatabasePath() {
  return path.join(getDataDir(), 'app.db');
}

module.exports = {
  getDataDir,
  getDatabasePath,
  getProfilesDir,
  getProjectRoot
};
