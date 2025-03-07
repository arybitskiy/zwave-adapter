/**
 *
 * index.js - Loads the ZWave adapter.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */


'use strict';

const {Database} = require('gateway-addon');
const manifest = require('./manifest.json');
const SerialPort = require('serialport');

function isZWavePort(port) {
  // Razberry support
  if (port.path === '/dev/ttyAMA0') {
    return true;
  }
  /**
   * The popular HUSBZB-1 adapter contains ZWave AND Zigbee radios. With the
   * most recent drivers from SiLabs, the radios are likely to enumerate in the
   * following order with the following names:
   *
   * /dev/tty.GoControl_zigbee
   * /dev/tty.GoControl_zwave
   *
   * Since `i` comes before `w` when the devices are listed, it's common for the
   * Zigbee radio to be returned as the ZWave radio. We need to scrutinize the
   * path of the radio to ensure that we're returning the actual ZWave one.
   */
  const isHUSBZB1 = port.vendorId == '10c4' && port.productId == '8a2a';
  if (isHUSBZB1) {
    const isGoControl = port.path.indexOf('GoControl') >= 0;
    if (isGoControl) {
      return port.path.indexOf('zwave') >= 0;
    }

    /**
     * There is also a chance the radios show up with more typical names, if
     * they're not using the latest drivers:
     *
     * /dev/ttyUSB0
     * /dev/ttyUSB1
     *
     * For now, since there's no good way to distinguish one radio from the
     * other with these names, and since this configuration was previously
     * valid below, return true.
     */
    return true;
  }

  return ((port.vendorId == '0658' &&
           port.productId == '0200') ||  // Aeotec Z-Stick Gen-5
          (port.vendorId == '0658' &&
           port.productId == '0280') ||  // UZB1
          (port.vendorId == '10c4' &&
           port.productId == 'ea60'));   // Aeotec Z-Stick S2
}

// Scan the serial ports looking for an OpenZWave adapter.
//
//    callback(error, port)
//        Upon success, callback is invoked as callback(null, port) where `port`
//        is the port object from SerialPort.list().
//        Upon failure, callback is invoked as callback(err) instead.
//
function findZWavePort(callback) {
  SerialPort.list().then((ports) => {
    for (const port of ports) {
      // Under OSX, SerialPort.list returns the /dev/tty.usbXXX instead
      // /dev/cu.usbXXX. tty.usbXXX requires DCD to be asserted which
      // isn't necessarily the case for ZWave dongles. The cu.usbXXX
      // doesn't care about DCD.
      if (port.path.startsWith('/dev/tty.usb')) {
        port.path = port.path.replace('/dev/tty', '/dev/cu');
      }

      if (isZWavePort(port)) {
        callback(null, port);
        return;
      }
    }

    callback('No ZWave port found');
  }).catch((error) => {
    callback(error);
  });
}

async function loadZWaveAdapters(addonManager, _, errorCallback) {
  let config = {};
  const db = new Database(manifest.id);
  await db.open().then(() => {
    return db.loadConfig();
  }).then((cfg) => {
    config = cfg;

    if (config.hasOwnProperty('debug')) {
      console.log(`DEBUG config = '${config.debug}'`);
      require('./zwave-debug').set(config.debug);
    }

    return db.saveConfig(config);
  }).then(() => {
    console.log('Closing database');
    db.close();
  });

  // We put the ZWaveAdapter require here rather then at the top of the
  // file so that the debug config gets initialized before we import
  // the adapter class.
  const ZWaveAdapter = require('./zwave-adapter');

  // Try to load openzwave-shared. This will fail if the libopenzwave.so
  // file can't be loaded for some reason, and we don't want to continue
  // any further if there is a problem on that front.
  let zwaveModule;
  try {
    zwaveModule = require('openzwave-shared');
  } catch (err) {
    errorCallback(manifest.id, `Failed to load openzwave-shared: ${err}`);
    return;
  }

  findZWavePort(function(error, port) {
    if (error) {
      errorCallback(manifest.id, 'Unable to find ZWave adapter');
      return;
    }

    console.log('Found ZWave port @', port.path);

    new ZWaveAdapter(addonManager, config, zwaveModule, port);

    // The zwave adapter will be added when it's driverReady method is called.
    // Prior to that we don't know what the homeID of the adapter is.
  });
}

module.exports = loadZWaveAdapters;
