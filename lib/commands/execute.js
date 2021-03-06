import { errors, errorFromCode, errorFromW3CJsonCode } from 'appium-base-driver';
import _ from 'lodash';
import url from 'url';
import { util } from 'appium-support';
import logger from '../logger';
import { installSSLCert, uninstallSSLCert } from 'appium-ios-simulator';
import { startHttpsServer } from '../server';


let commands = {}, helpers = {}, extensions = {};

commands.execute = async function execute (script, args) {
  if (script.match(/^mobile:/)) {
    script = script.replace(/^mobile:/, '').trim();
    return await this.executeMobile(script, _.isArray(args) ? args[0] : args);
  } else {
    if (this.isWebContext()) {
      args = this.convertElementsForAtoms(args);
      return await this.executeAtom('execute_script', [script, args]);
    } else {
      return await this.uiAutoClient.sendCommand(script);
    }
  }
};

commands.executeAsync = async function executeAsync (script, args, sessionId) {
  if (!this.isWebContext()) {
    return await this.uiAutoClient.sendCommand(script);
  }

  let address = this.opts.callbackAddress || this.opts.address;
  let port = this.opts.callbackPort || this.opts.port;
  sessionId = sessionId || this.sessionId;

  // https sites need to reply to an https endpoint, in Safari
  let protocol = 'http:';
  try {
    let currentUrl = url.parse(await this.getUrl());
    if (currentUrl.protocol === 'https:' && this.opts.httpsCallbackPort && this.opts.httpsCallbackAddress) {
      protocol = currentUrl.protocol;
      port = this.opts.httpsCallbackPort;
      address = this.opts.httpsCallbackAddress;
    }
  } catch (ign) {}
  let responseUrl = `${protocol}//${address}:${port}/wd/hub/session/${sessionId}/receive_async_response`;

  if (this.isRealDevice()) {
    let defaultHost = this.opts.address;
    let urlObject = url.parse(responseUrl);
    if (urlObject.hostname === defaultHost) {
      logger.debug('Real device safari test and no custom callback address ' +
                   'set, changing callback address to local ip.');
      urlObject.hostname = util.localIp();
      urlObject.host = null; // set to null, otherwise hostname is ignored
      responseUrl = url.format(urlObject);
    } else {
      logger.debug('Custom callback address set, leaving as is.');
    }
  }

  logger.debug(`Response url for executeAsync: ${responseUrl}`);
  args = this.convertElementsForAtoms(args);
  this.asyncWaitMs = this.asyncWaitMs || 0;
  return await this.executeAtomAsync('execute_async_script', [script, args, this.asyncWaitMs], responseUrl);
};

commands.receiveAsyncResponse = async function receiveAsyncResponse (status, value) { // eslint-disable-line require-await
  logger.debug(`Received async response: ${JSON.stringify(value)}`);
  if (!util.hasValue(this.asyncPromise)) {
    logger.warn(`Received async response when we were not expecting one! ` +
      `Response was: ${JSON.stringify(value)}`);
    return;
  }

  if (util.hasValue(status) && status !== 0) {
    // MJSONWP
    return this.asyncPromise.reject(errorFromCode(status, value.message));
  }
  if (!util.hasValue(status) && value && _.isString(value.error)) {
    // W3C
    return this.asyncPromise.reject(errorFromW3CJsonCode(value.error, value.message, value.stacktrace));
  }
  return this.asyncPromise.resolve(value);
};

helpers.startHttpsAsyncServer = async function startHttpsAsyncServer () {
  logger.debug('Starting https server for async responses');
  let address = this.opts.callbackAddress || this.opts.address;
  let port = this.opts.callbackPort || this.opts.port;
  let {sslServer, pemCertificate, httpsPort} = await startHttpsServer(port, address);
  this.opts.sslServer = sslServer;
  this.opts.httpsServerCertificate = pemCertificate;
  this.opts.httpsCallbackPort = httpsPort;
  this.opts.httpsCallbackAddress = 'localhost';
  let udid;
  if (this.sim) {
    // ios driver
    udid = this.sim.udid;
  } else {
    // xcuitest driver
    udid = this.opts.udid;
  }
  await installSSLCert(this.opts.httpsServerCertificate, udid);
};

helpers.stopHttpsAsyncServer = async function stopHttpsAsyncServer () {
  logger.debug('Stopping https server for async responses');
  if (this.opts.sslServer) {
    await this.opts.sslServer.close();
  }
  await uninstallSSLCert(this.opts.httpsServerCertificate, this.opts.udid);
};

commands.executeMobile = async function executeMobile (mobileCommand, opts = {}) {
  // we only support mobile: scroll
  if (mobileCommand === 'scroll') {
    await this.mobileScroll(opts);
  } else if (mobileCommand === 'viewportScreenshot') {
    return await this.getViewportScreenshot();
  } else {
    throw new errors.UnknownCommandError('Unknown command, all the mobile commands except scroll have been removed.');
  }
};

Object.assign(extensions, commands, helpers);
export { commands, helpers };
export default extensions;
