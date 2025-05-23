import { ApiClient, CorelliumApi } from '@corellium/client-api';
import type { ExtensionContext, QuickPickItem } from 'vscode';
import { commands, env, Uri, window, workspace } from 'vscode';
import CorelliumConsole from './lib/console';
import type CorelliumInstance from './lib/corelliumInstance';
import parseError from './lib/parseError';
import VirtualDevicesProvider from './lib/virtualDevicesProvider';

let apiInstance: CorelliumApi | null = null;

// eslint-disable-next-line no-undef
let refreshTimer: NodeJS.Timeout | null = null;

export const activate = (context: ExtensionContext): void => {
  // Set up the API client object, note that apiInstance is global
  const configuration = workspace.getConfiguration('avh');
  const defaultClient = ApiClient.instance;
  const endpoint = configuration.get('endpoint');
  const apiKey = configuration.get('ApiKey');

  // Overwrite the default endpoint and bearer auth
  if (typeof endpoint === 'string') {
    defaultClient.basePath = `${endpoint}/api`;
  }
  if (typeof apiKey === 'string') {
    defaultClient.authentications.BearerAuth.accessToken = apiKey;
  }

  apiInstance = new CorelliumApi();

  // Set up tree view for projects/devices
  const virtualDevicesProvider = new VirtualDevicesProvider(apiInstance);
  window.registerTreeDataProvider('virtualDevices', virtualDevicesProvider);

  const refreshDevicesCommandHandler = () => {
    virtualDevicesProvider.refresh();
  };

  workspace.onDidChangeConfiguration(async (event) => {
    const affected =
      event.affectsConfiguration('avh.endpoint') ||
      event.affectsConfiguration('avh.ApiKey');

    if (affected) {
      await window.showInformationMessage(
        'AVH configuration changed, please reload the window to apply changes and restart the extension.',
        'Reload Window'
      );
      await commands.executeCommand('workbench.action.reloadWindow');
    }
  });

  // Command handlers
  const turnOnDeviceCommandHandler = async (instance: CorelliumInstance) => {
    try {
      await apiInstance?.v1StartInstance(instance.instanceUUID);
      refreshDevicesCommandHandler();
      await window.showInformationMessage(`Turning on ${instance.label}`);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to turn on device: ${message}`);
    }
  };

  const turnOffDeviceCommandHandler = async (instance: CorelliumInstance) => {
    try {
      await apiInstance?.v1StopInstance(instance.instanceUUID);
      refreshDevicesCommandHandler();
      await window.showInformationMessage(`Turning off ${instance.label}`);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to turn off device: ${message}`);
    }
  };

  const rebootDeviceCommandHandler = async (instance: CorelliumInstance) => {
    try {
      await apiInstance?.v1RebootInstance(instance.instanceUUID);
      refreshDevicesCommandHandler();
      await window.showInformationMessage(`Rebooting ${instance.label}`);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to reboot device: ${message}`);
    }
  };

  const pauseDeviceCommandHandler = async (instance: CorelliumInstance) => {
    try {
      await apiInstance?.v1PauseInstance(instance.instanceUUID);
      refreshDevicesCommandHandler();
      await window.showInformationMessage(`Pausing ${instance.label}`);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to pause device: ${message}`);
    }
  };

  const unpauseDeviceCommandHandler = async (instance: CorelliumInstance) => {
    try {
      await apiInstance?.v1UnpauseInstance(instance.instanceUUID);
      refreshDevicesCommandHandler();
      await window.showInformationMessage(`Unpausing ${instance.label}`);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to unpause device: ${message}`);
    }
  };

  const openInBrowserCommandHandler = async (instance: CorelliumInstance) => {
    const parsedEndpoint =
      typeof endpoint === 'string' ? endpoint : 'https://app.avh.com';
    const url = new URL(
      `devices/${instance.instanceUUID}/connect`,
      parsedEndpoint
    );
    const external = Uri.parse(url.href);

    try {
      await env.openExternal(external);
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(
        `Failed to open device in browser: ${message}`
      );
    }
  };

  // const writeEmitter = new vscode.EventEmitter<string>();
  const openConsoleCommandHandler = async (instance: CorelliumInstance) => {
    try {
      const consoleResult = await apiInstance?.v1GetInstanceConsole(
        instance.instanceUUID
      );
      const consoleWSUrl = consoleResult?.url;

      if (!consoleWSUrl) {
        throw new Error('No console URL returned');
      }

      const pty = new CorelliumConsole(consoleWSUrl);
      const terminal = window.createTerminal({
        name: `Console: ${instance.label}`,
        pty,
      });

      terminal.show();
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(
        `Failed to open device console: ${message}`
      );
    }
  };

  const takeSnapshotCommandHandler = async (instance: CorelliumInstance) => {
    try {
      const snapshotName = await window.showInputBox({
        placeHolder: 'My New Snapshot',
        prompt: 'Snapshot Name:',
        value: 'My New Snapshot',
      });
      const snapshotCreationOptions = {
        name: snapshotName,
      };

      const data = await apiInstance?.v1CreateSnapshot(
        instance.instanceUUID,
        snapshotCreationOptions
      );

      if (!data?.id) {
        throw new Error('No snapshot ID returned');
      }

      await window.showInformationMessage(
        `Snapshotting ${instance.label}: ${data.id}`
      );
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to take snapshot: ${message}`);
    }
  };

  const restoreSnapshotCommandHandler = async (instance: CorelliumInstance) => {
    try {
      const snapshots = await apiInstance?.v1GetSnapshots(
        instance.instanceUUID
      );

      if (!snapshots?.length) {
        throw new Error('No snapshots returned');
      }

      const items: QuickPickItem[] = snapshots.map((snapshot) => ({
        label: snapshot.name,
        description: snapshot.id,
      }));

      const selection = await window.showQuickPick(items);

      if (!selection) {
        // User cancelled
        return;
      }

      if (!selection.description) {
        throw new Error('No snapshot ID returned');
      }

      await apiInstance?.v1RestoreSnapshot(
        instance.instanceUUID,
        selection.description
      );

      await window.showInformationMessage(
        `Restoring snapshot ${selection.label} on ${instance.label}`
      );
    } catch (error) {
      const message = parseError(error);
      await window.showErrorMessage(`Failed to restore snapshot: ${message}`);
    }
  };

  refreshTimer = setInterval(() => {
    refreshDevicesCommandHandler();
  }, 10000);

  context.subscriptions.push(
    commands.registerCommand('avh.startDevice', turnOnDeviceCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.stopDevice', turnOffDeviceCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.rebootDevice', rebootDeviceCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.pauseDevice', pauseDeviceCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.unpauseDevice', unpauseDeviceCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.openInBrowser', openInBrowserCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.openConsole', openConsoleCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand('avh.takeSnapshot', takeSnapshotCommandHandler)
  );
  context.subscriptions.push(
    commands.registerCommand(
      'avh.restoreSnapshot',
      restoreSnapshotCommandHandler
    )
  );
  context.subscriptions.push(
    commands.registerCommand('avh.refreshDevices', refreshDevicesCommandHandler)
  );
};

// this method is called when your extension is deactivated
export const deactivate = (): void => {
  apiInstance = null;
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
};
