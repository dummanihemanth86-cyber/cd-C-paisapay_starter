'use strict';

const appConfig = require('../app.json');

function getInstalledVersion() {
  return appConfig.expo.version;
}

module.exports = { getInstalledVersion };
