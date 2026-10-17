// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // --- Discovery and device lifecycle --------------------------------------------
  gladys.onScanRequest(() => app.publishDiscovery());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // --- Read only: every command is refused with a clear message.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // --- Configuration screen buttons -----------------------------------------------
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.TRUST_CERTIFICATE, () => app.trustNewCertificate());

  // --- Configuration saved by the user: a key refused earlier is tried again.
  gladys.onConfigUpdated((config) => {
    logger?.info('Configuration updated: restarting');
    return app.start(config, { force: true });
  });

  // --- Connection lifecycle: (re)start on every connection (everything is
  // published again), pause while Gladys is away. A refused key and a pause
  // are kept in /data: a reconnection does not lift them.
  gladys.on('connected', async () => {
    try {
      await app.start(await gladys.getConfig());
    } catch (err) {
      logger?.error(`Start failed: ${app.describe(err)}`);
    }
  });
  gladys.on('disconnected', () => app.stop());
}
