// A headless Firefox with Mirrorly installed for the session, for when the
// user's own Firefox isn't connected. It runs the same agent code in the
// extension, through a private bridge on a free port, so the commands and
// results are identical either way.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Bridge } = require('./bridge');
const { buildXpi } = require('./xpi');

const UUID = '3c7a1f52-9e0d-4b6a-8f31-6d2e5b9c0a47';
const ADDON_ID = 'mirrorly@dazecoop';

class Headless {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.driver = null;
    this.bridge = null;
    this.starting = null;
  }

  start() {
    if (!this.starting) this.starting = this.launch().catch((err) => {
      this.starting = null;
      throw err;
    });
    return this.starting;
  }

  async launch() {
    let selenium;
    try {
      selenium = { ...require('selenium-webdriver'), firefox: require('selenium-webdriver/firefox') };
    } catch {
      throw new Error('Headless mode needs the selenium-webdriver package (npm install).');
    }
    this.bridge = new Bridge({ port: 0, shared: false, idleMs: 0, client: 'mirrorly-headless' });
    await this.bridge.use();

    const xpi = buildXpi(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mirrorly-')), 'mirrorly.xpi'));
    const options = new selenium.firefox.Options()
      .addArguments('-headless')
      .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));
    if (process.env.MIRRORLY_FIREFOX) options.setBinary(process.env.MIRRORLY_FIREFOX);
    // System access lets the driver open the extension's own page.
    const service = new selenium.firefox.ServiceBuilder().addArguments('--allow-system-access');
    this.log('Starting headless Firefox…');
    try {
      this.driver = await new selenium.Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
    } catch (err) {
      await this.bridge.close();
      throw new Error(`Couldn't start headless Firefox (${err.message.split('\n')[0]}). Install Firefox, or set MIRRORLY_FIREFOX to its binary.`);
    }
    await this.driver.installAddon(xpi, true);
    await this.driver.manage().window().setRect({ width: 1400, height: 1000 });
    // Switch the agent bridge on, pointed at this browser's private port.
    await this.driver.get(`moz-extension://${UUID}/sidebar/sidebar.html?window=other`);
    await this.driver.executeScript('return browser.storage.local.set(arguments[0])', { agentBridge: true, agentPort: this.bridge.port });
    await this.driver.get('about:blank');
    if (!(await this.bridge.waitForExtension(20000))) {
      await this.close();
      throw new Error('Mirrorly didn\'t start in headless Firefox.');
    }
    this.log('Headless Firefox is ready.');
  }

  async command(session, cmd, args) {
    await this.start();
    return this.bridge.command(session, cmd, args);
  }

  async close() {
    const { driver, bridge } = this;
    this.driver = null;
    this.bridge = null;
    this.starting = null;
    await Promise.allSettled([driver?.quit(), bridge?.close()]);
  }
}

module.exports = { Headless };
